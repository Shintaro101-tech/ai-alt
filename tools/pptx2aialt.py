#!/usr/bin/env python3
"""PowerPoint (.pptx) -> AI-ALT slide file (.aialt-slides.json).

Each slide is split into its click steps (the state after every click of its
animations). PowerPoint itself draws every step (it exports a temporary copy of
the deck to PDF), so the pictures look exactly like the original. For every click
the file also records which shapes animate, where they are and how (fade, fly in,
wipe, zoom...), and AI-ALT replays that animation in the browser.

Also kept per slide: its text and its speaker notes (they become the ALT's memo).

Needs: macOS, Microsoft PowerPoint, python-pptx (pip install python-pptx), poppler
(brew install poppler, for pdftoppm).

Usage: python3 pptx2aialt.py slides.pptx [-o out.aialt-slides.json] [--width 1920]
"""

import argparse
import base64
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from posixpath import dirname, join, normpath

from lxml import etree
from pptx import Presentation
from pptx.util import Emu

NS = {
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
    'ct': 'http://schemas.openxmlformats.org/package/2006/content-types',
}
P = '{%s}' % NS['p']
A = '{%s}' % NS['a']
R = '{%s}' % NS['r']
SHAPE_TAGS = {P + t for t in ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp', 'contentPart')}
SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'

# PowerPoint preset ids (entrance) -> how AI-ALT animates them. Anything else fades.
ENTRANCE = {1: 'appear', 2: 'fly', 10: 'fade', 22: 'wipe', 42: 'float', 47: 'float', 53: 'zoom',
            23: 'zoom', 21: 'wipe', 16: 'wipe', 12: 'fade', 37: 'float', 26: 'zoom', 31: 'zoom'}
# presetSubtype for fly / wipe: where it comes from.
DIRS = {1: 'top', 2: 'right', 4: 'bottom', 8: 'left', 3: 'right', 6: 'right', 9: 'left', 12: 'left'}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- reading the animations

def num(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def effect_start(ctn, group):
    """Milliseconds from the click to the start of an effect: the numeric delays of
    every timing node between the click group and the effect."""
    total = 0
    node = ctn
    while node is not None and node is not group:
        if node.tag == P + 'cTn':
            for cond in node.findall('p:stCondLst/p:cond', NS):
                total += num(cond.get('delay'), 0)
        node = node.getparent()
    return total


def effect_duration(ctn):
    durs = [num(c.get('dur'), 0) for c in ctn.iter(P + 'cTn') if c is not ctn and c.get('dur') not in (None, 'indefinite')]
    return max([d for d in durs if d > 1] or [500])


def read_timing(slide_el):
    """List of click groups. Each group: {'auto': bool, 'effects': [...]}, where an effect
    is {'spid', 'paras': (st, end) | None, 'cls': 'entr'|'exit'|'emph', 'preset', 'sub', 'start', 'dur'}."""
    seq = slide_el.find('.//p:timing//p:cTn[@nodeType="mainSeq"]', NS)
    if seq is None:
        return []
    groups = []
    for par in seq.findall('p:childTnLst/p:par', NS):
        gctn = par.find('p:cTn', NS)
        conds = gctn.findall('p:stCondLst/p:cond', NS) if gctn is not None else []
        auto = not any(c.get('delay') == 'indefinite' for c in conds)
        effects = []
        for ctn in par.iter(P + 'cTn'):
            cls = ctn.get('presetClass')
            if not cls:
                continue
            tgt = ctn.find('.//p:spTgt', NS)
            if tgt is None:
                continue
            rg = tgt.find('p:txEl/p:pRg', NS)
            effects.append({
                'spid': tgt.get('spid'),
                'paras': (num(rg.get('st')), num(rg.get('end'))) if rg is not None else None,
                'cls': cls,
                'preset': num(ctn.get('presetID'), 0),
                'sub': num(ctn.get('presetSubtype'), 0),
                'start': effect_start(ctn, par),
                'dur': effect_duration(ctn),
            })
        sounds = []
        for snd in par.iter(P + 'sndTgt'):
            node = snd.getparent()
            while node is not None and node.tag != P + 'cMediaNode':
                node = node.getparent()
            ctn = node.find('p:cTn', NS) if node is not None else None
            sounds.append({'rid': snd.get(R + 'embed'), 'name': snd.get('name') or '',
                           'start': effect_start(ctn, par) if ctn is not None else 0})
        media = []
        for cmd in par.iter(P + 'cmd'):
            what = (cmd.get('cmd') or '').split('(')[0]
            tgt = cmd.find('.//p:spTgt', NS)
            if tgt is None or what not in ('playFrom', 'togglePause', 'stop'):
                continue
            ctn = cmd.find('p:cBhvr/p:cTn', NS)
            m = re.match(r'playFrom\(([\d.]+)\)', cmd.get('cmd') or '')
            media.append({'spid': tgt.get('spid'), 'cmd': what, 'from': float(m.group(1)) if m else 0.0,
                          'start': effect_start(ctn, par) if ctn is not None else 0})
        groups.append({'auto': auto, 'effects': effects, 'sounds': sounds, 'media': media})
    return groups


def click_steps(groups):
    """Auto groups at the very start belong to the slide's first state; later auto
    groups run right after the click before them. Returns (start_effects, [click effects])."""
    start, clicks = [], []
    for g in groups:
        if g['auto']:
            (clicks[-1] if clicks else start).extend(g['effects'])
        else:
            clicks.append(list(g['effects']))
    return start, clicks


# ---------------------------------------------------------------- slide states

def visibility(start, clicks):
    """For each state 0..len(clicks): which shapes / paragraphs are hidden.
    Returns a list of (hidden_shapes:set, hidden_paras:{spid: set(index)})."""
    # Initial state: whatever enters later starts hidden (looking at the first effect per target).
    first = {}
    for eff in [*start, *[e for c in clicks for e in c]]:
        key = (eff['spid'], eff['paras'])
        if eff['cls'] in ('entr', 'exit') and key not in first:
            first[key] = eff['cls']
    hidden_shapes = {spid for (spid, paras), cls in first.items() if cls == 'entr' and paras is None}
    hidden_paras = {}
    for (spid, paras), cls in first.items():
        if cls == 'entr' and paras is not None:
            hidden_paras.setdefault(spid, set()).update(range(paras[0], paras[1] + 1))

    def apply(effs, shapes, paras):
        for eff in effs:
            if eff['cls'] not in ('entr', 'exit'):
                continue
            show = eff['cls'] == 'entr'
            if eff['paras'] is None:
                (shapes.discard if show else shapes.add)(eff['spid'])
            else:
                s = paras.setdefault(eff['spid'], set())
                rng = range(eff['paras'][0], eff['paras'][1] + 1)
                (s.difference_update if show else s.update)(rng)

    shapes, paras = set(hidden_shapes), {k: set(v) for k, v in hidden_paras.items()}
    apply(start, shapes, paras)
    states = [(set(shapes), {k: set(v) for k, v in paras.items()})]
    for c in clicks:
        apply(c, shapes, paras)
        states.append((set(shapes), {k: set(v) for k, v in paras.items()}))
    return states


def make_state_xml(slide_xml, hidden_shapes, hidden_paras):
    root = etree.fromstring(slide_xml)
    for el in list(root.iter()):
        if el.tag in SHAPE_TAGS:
            nv = el.find('.//p:cNvPr', NS)
            if nv is not None and nv.get('id') in hidden_shapes and el.getparent() is not None:
                el.getparent().remove(el)
    for el in root.iter(P + 'sp'):
        nv = el.find('.//p:cNvPr', NS)
        idx = hidden_paras.get(nv.get('id')) if nv is not None else None
        if not idx:
            continue
        for i, para in enumerate(el.findall('p:txBody/a:p', NS)):
            if i in idx:
                hide_paragraph(para)
    for tag in ('p:timing', 'p:transition'):
        for t in root.findall(tag, NS):
            root.remove(t)
    for t in root.findall('.//{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent'):
        if t.find('.//p:transition', NS) is not None:
            t.getparent().remove(t)
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def clear_fill(rpr):
    for tag in ('a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill'):
        for f in rpr.findall(tag, NS):
            rpr.remove(f)
    no = etree.Element(A + 'noFill')
    ln = rpr.find('a:ln', NS)
    (ln.addnext(no) if ln is not None else rpr.insert(0, no))


def hide_paragraph(para):
    """Keeps the paragraph's space (so the others don't move) but draws nothing."""
    ppr = para.find('a:pPr', NS)
    if ppr is None:
        ppr = etree.SubElement(para, A + 'pPr')
        para.insert(0, ppr)
    for tag in ('a:buClrTx', 'a:buClr'):
        for b in ppr.findall(tag, NS):
            ppr.remove(b)
    clr = etree.Element(A + 'buClr')
    etree.SubElement(etree.SubElement(clr, A + 'srgbClr', val='FFFFFF'), A + 'alpha', val='0')
    # Schema order: lnSpc, spcBef, spcAft, then the bullet colour.
    before = [c for c in ppr if c.tag in (A + 'lnSpc', A + 'spcBef', A + 'spcAft')]
    (before[-1].addnext(clr) if before else ppr.insert(0, clr))
    for r in para.findall('a:r', NS) + para.findall('a:fld', NS):
        rpr = r.find('a:rPr', NS)
        if rpr is None:
            rpr = etree.Element(A + 'rPr')
            r.insert(0, rpr)
        clear_fill(rpr)
    end = para.find('a:endParaRPr', NS)
    if end is not None:
        clear_fill(end)


# ---------------------------------------------------------------- geometry & text (python-pptx)

def shape_boxes(slide, W, H):
    """spid -> [x, y, w, h] as fractions of the slide (groups resolved)."""
    boxes = {}

    def walk(shapes, tf):
        for sh in shapes:
            try:
                x, y, w, h = sh.left, sh.top, sh.width, sh.height
            except Exception:
                continue
            if None in (x, y, w, h):
                continue
            X, Y = tf(x, y)
            sx, sy = tf.scale
            boxes[str(sh.shape_id)] = [X / W, Y / H, w * sx / W, h * sy / H]
            if sh.shape_type == 6:  # group
                xfrm = sh._element.find('p:grpSpPr/a:xfrm', NS)
                ch_off, ch_ext = xfrm.find('a:chOff', NS), xfrm.find('a:chExt', NS)
                cx0, cy0 = int(ch_off.get('x')), int(ch_off.get('y'))
                cw, chh = int(ch_ext.get('cx')) or 1, int(ch_ext.get('cy')) or 1
                ksx, ksy = w * sx / cw, h * sy / chh

                def child(px, py, X=X, Y=Y, cx0=cx0, cy0=cy0, ksx=ksx, ksy=ksy):
                    return X + (px - cx0) * ksx, Y + (py - cy0) * ksy
                child.scale = (ksx, ksy)
                walk(sh.shapes, child)

    def root(px, py):
        return px, py
    root.scale = (1, 1)
    walk(slide.shapes, root)
    return boxes


def slide_text(slide):
    out = []

    def walk(shapes):
        for sh in shapes:
            if sh.shape_type == 6:
                walk(sh.shapes)
            elif getattr(sh, 'has_text_frame', False) and sh.has_text_frame:
                t = sh.text_frame.text.strip()
                if t:
                    out.append(t)
            elif getattr(sh, 'has_table', False) and sh.has_table:
                for row in sh.table.rows:
                    out.append(' | '.join(c.text.strip() for c in row.cells))
    walk(slide.shapes)
    return '\n'.join(out)


def slide_title(slide):
    try:
        if slide.shapes.title is not None and slide.shapes.title.text.strip():
            return slide.shapes.title.text.strip().split('\n')[0]
    except Exception:
        pass
    return ''


# ---------------------------------------------------------------- sounds and music

AUDIO_MIME = {'.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac',
              '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg'}


def slide_rels(z, part):
    """rId -> zip path of the target (internal targets only)."""
    try:
        rels = etree.fromstring(z.read(rels_path(part)))
    except KeyError:
        return {}
    out = {}
    for rel in rels.findall('rel:Relationship', NS):
        if rel.get('TargetMode') == 'External':
            continue
        out[rel.get('Id')] = resolve(part, rel.get('Target'))
    return out


_audio_cache = {}


def audio_data_url(z, path):
    """The sound as a data: URL a browser can play (other formats are converted with afconvert)."""
    if path in _audio_cache:
        return _audio_cache[path]
    try:
        data = z.read(path)
    except KeyError:
        return None
    ext = os.path.splitext(path)[1].lower()
    mime = AUDIO_MIME.get(ext)
    if not mime:
        tmp = tempfile.mkdtemp(prefix='aialt_snd_')
        try:
            src = os.path.join(tmp, 'in' + ext)
            dst = os.path.join(tmp, 'out.m4a')
            with open(src, 'wb') as f:
                f.write(data)
            r = subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', src, dst], capture_output=True)
            if r.returncode != 0 or not os.path.exists(dst):
                log(f'  （この音声は再生できない形式のため省きます: {os.path.basename(path)}）')
                _audio_cache[path] = None
                return None
            with open(dst, 'rb') as f:
                data = f.read()
            mime = 'audio/mp4'
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    url = f'data:{mime};base64,' + base64.b64encode(data).decode()
    _audio_cache[path] = url
    return url


def media_shapes(slide_el, rels):
    """spid -> zip path of the audio file for audio shapes on the slide (videos are skipped)."""
    out = {}
    for nv in slide_el.iter(P + 'nvPicPr', P + 'nvSpPr'):
        cnv = nv.find('p:cNvPr', NS)
        nvpr = nv.find('p:nvPr', NS)
        if cnv is None or nvpr is None:
            continue
        audio = nvpr.find('a:audioFile', NS)
        if audio is None:
            continue
        path = None
        for el in nvpr.iter():
            if el.tag.endswith('}media') and el.get(R + 'embed') in rels:
                path = rels[el.get(R + 'embed')]
        if path is None:
            path = rels.get(audio.get(R + 'link'))
        if path:
            out[cnv.get('id')] = path
    return out


def media_settings(slide_el):
    """spid -> {'vol', 'loop', 'slides'} from the slide's timing (p:audio / p:cMediaNode)."""
    out = {}
    for node in slide_el.iter(P + 'cMediaNode'):
        tgt = node.find('p:tgtEl/p:spTgt', NS)
        if tgt is None:
            continue
        ctn = node.find('p:cTn', NS)
        out[tgt.get('spid')] = {
            'vol': round(num(node.get('vol'), 100000) / 100000, 2),
            'loop': ctn is not None and ctn.get('repeatCount') == 'indefinite',
            'slides': max(1, num(node.get('numSld'), 1)),
        }
    return out


def slide_sounds(z, part, slide_el, groups):
    """Sounds of one slide: [{'at': click number (0 = when the slide appears), 'start': ms,
    'kind': 'sfx'|'track', 'src': data URL, ...}] and the transition sound."""
    rels = slide_rels(z, part)
    shapes = media_shapes(slide_el, rels)
    settings = media_settings(slide_el)
    out = []
    click = 0
    seen_click = False
    for g in groups:
        if not g['auto']:
            click += 1
            seen_click = True
        at = click if (seen_click or not g['auto']) else 0
        for snd in g.get('sounds', []):
            src = audio_data_url(z, rels.get(snd['rid'], '')) if snd['rid'] in rels else None
            if src:
                out.append({'at': at, 'start': snd['start'], 'kind': 'sfx', 'src': src, 'name': snd['name']})
        for m in g.get('media', []):
            path = shapes.get(m['spid'])
            src = audio_data_url(z, path) if path else None
            if not src:
                continue
            st = settings.get(m['spid'], {'vol': 1, 'loop': False, 'slides': 1})
            out.append({'at': at, 'start': m['start'], 'kind': 'track', 'cmd': m['cmd'], 'from': m['from'],
                        'id': f"{part}#{m['spid']}", 'src': src, 'vol': st['vol'], 'loop': st['loop'],
                        'slides': st['slides'], 'name': os.path.basename(path)})
    transition = None
    tr = slide_el.find('.//p:transition', NS)
    if tr is not None:
        snd = tr.find('.//p:sndAc/p:stSnd/p:snd', NS)
        if snd is not None and snd.get(R + 'embed') in rels:
            src = audio_data_url(z, rels[snd.get(R + 'embed')])
            if src:
                st_snd = snd.getparent()
                transition = {'src': src, 'loop': st_snd.get('loop') in ('1', 'true'), 'name': snd.get('name') or ''}
        elif tr.find('.//p:sndAc/p:endSnd', NS) is not None:
            transition = {'stop': True}
    return out, transition


def effect_for_browser(eff, boxes):
    box = boxes.get(eff['spid'])
    if not box:
        return None
    kind = 'fade'
    direction = ''
    if eff['cls'] == 'entr':
        kind = ENTRANCE.get(eff['preset'], 'fade')
        if kind in ('fly', 'wipe'):
            direction = DIRS.get(eff['sub'], 'bottom' if kind == 'fly' else 'left')
        # Moving a whole text box when only one paragraph appears would move the others too.
        if eff['paras'] is not None and kind in ('fly', 'zoom', 'float'):
            kind = 'fade'
    elif eff['cls'] == 'exit':
        kind = 'fade'  # the new picture (without the shape) fades in over it
    else:
        return None
    return {'box': [round(v, 5) for v in box], 'kind': kind, 'dir': direction, 'exit': eff['cls'] == 'exit',
            'start': eff['start'], 'dur': min(max(eff['dur'], 1), 3000)}


# ---------------------------------------------------------------- building the expanded deck

def rels_path(part):
    return join(dirname(part), '_rels', part.split('/')[-1] + '.rels')


def resolve(base_part, target):
    return normpath(join(dirname(base_part), target))


def build_expanded(src_zip, plan, out_path):
    """plan: list of (slide_part, [state_xml bytes]) in presentation order."""
    files = {n: src_zip.read(n) for n in src_zip.namelist()}
    ct = etree.fromstring(files['[Content_Types].xml'])
    pres = etree.fromstring(files['ppt/presentation.xml'])
    pres_rels = etree.fromstring(files['ppt/_rels/presentation.xml.rels'])

    # Drop the old slides, their notes and comments.
    old = {p for p, _ in plan}
    drop = set(old)
    for part in old:
        rp = rels_path(part)
        if rp in files:
            for rel in etree.fromstring(files[rp]):
                t = rel.get('Type', '')
                if t.endswith('/notesSlide') or t.endswith('/comments'):
                    drop.add(resolve(part, rel.get('Target')))
    for part in list(drop):
        files.pop(part, None)
        files.pop(rels_path(part), None)
    for o in list(ct):
        if o.get('PartName', '').lstrip('/') in drop:
            ct.remove(o)
    for rel in list(pres_rels):
        if rel.get('Type', '').endswith('/slide'):
            pres_rels.remove(rel)

    lst = pres.find('p:sldIdLst', NS)
    for s in list(lst):
        lst.remove(s)

    copies = {}
    def copy_part(target_part):
        """Charts / SmartArt can't be shared by several slides: give each slide its own copy."""
        copies[target_part] = copies.get(target_part, 0) + 1
        if copies[target_part] == 1:
            return target_part
        stem, ext = os.path.splitext(target_part)
        new = f'{stem}_c{copies[target_part]}{ext}'
        files[new] = files[target_part]
        if rels_path(target_part) in files:
            files[rels_path(target_part)] = files[rels_path(target_part)]
        for o in ct:
            if o.get('PartName', '').lstrip('/') == target_part:
                n = copy.deepcopy(o)
                n.set('PartName', '/' + new)
                ct.append(n)
                break
        return new

    n = 0
    next_id = 256
    for part, states in plan:
        src_rels = etree.fromstring(src_zip.read(rels_path(part))) if rels_path(part) in src_zip.namelist() else None
        for xml in states:
            n += 1
            new_part = f'ppt/slides/slide{n}.xml'
            files[new_part] = xml
            if src_rels is not None:
                rels = copy.deepcopy(src_rels)
                for rel in list(rels):
                    t = rel.get('Type', '')
                    if t.endswith('/notesSlide') or t.endswith('/comments'):
                        rels.remove(rel)
                    elif rel.get('TargetMode') != 'External' and re.search(r'/(chart|diagramData|diagramLayout|diagramColors|diagramQuickStyle|diagramDrawing)$', t):
                        tp = resolve(part, rel.get('Target'))
                        if tp in files:
                            np_ = copy_part(tp)
                            rel.set('Target', os.path.relpath(np_, dirname(new_part)))
                files[rels_path(new_part)] = etree.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
            o = etree.SubElement(ct, '{%s}Override' % NS['ct'])
            o.set('PartName', '/' + new_part)
            o.set('ContentType', SLIDE_CT)
            rid = f'rIdAialt{n}'
            rel = etree.SubElement(pres_rels, '{%s}Relationship' % NS['rel'])
            rel.set('Id', rid)
            rel.set('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide')
            rel.set('Target', f'slides/slide{n}.xml')
            sid = etree.SubElement(lst, P + 'sldId')
            sid.set('id', str(next_id))
            sid.set(R + 'id', rid)
            next_id += 1

    # Sections / custom shows refer to the old slide ids.
    for ext in pres.findall('.//p:extLst', NS):
        ext.getparent().remove(ext)
    for cs in pres.findall('p:custShowLst', NS):
        pres.remove(cs)

    files['[Content_Types].xml'] = etree.tostring(ct, xml_declaration=True, encoding='UTF-8', standalone=True)
    files['ppt/presentation.xml'] = etree.tostring(pres, xml_declaration=True, encoding='UTF-8', standalone=True)
    files['ppt/_rels/presentation.xml.rels'] = etree.tostring(pres_rels, xml_declaration=True, encoding='UTF-8', standalone=True)
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', files.pop('[Content_Types].xml'))
        for name, data in files.items():
            z.writestr(name, data)
    return n


def powerpoint_pdf(pptx_path, pdf_path):
    script = f'''
with timeout of 300 seconds
  tell application "Microsoft PowerPoint"
    open POSIX file "{pptx_path}"
    delay 2
    set p to active presentation
    save p in POSIX file "{pdf_path}" as save as PDF
    close p saving no
  end tell
end timeout'''
    r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(pdf_path):
        close_presentation(pptx_path)
        raise SystemExit(f'PowerPoint でPDFにできませんでした。PowerPoint に確認の画面が出ていないか見てください。（{r.stderr.strip()}）')


def close_presentation(pptx_path):
    """After a failure, closes our working copy if PowerPoint still has it open."""
    name = os.path.basename(pptx_path)
    script = f'''
with timeout of 20 seconds
  tell application "Microsoft PowerPoint"
    repeat with p in (every presentation whose name is "{name}")
      close p saving no
    end repeat
  end tell
end timeout'''
    subprocess.run(['osascript', '-e', script], capture_output=True, text=True)


# ---------------------------------------------------------------- main

def convert(src, out, width=1920, quality=88):
    src = os.path.abspath(src)
    _audio_cache.clear()
    prs = Presentation(src)
    W, H = prs.slide_width, prs.slide_height
    z = zipfile.ZipFile(src)
    order = [s.part.partname.lstrip('/') for s in prs.slides]

    plan, meta = [], []
    for i, (slide, part) in enumerate(zip(prs.slides, order)):
        hidden_attr = slide._element.get('show') == '0'
        if hidden_attr:
            continue  # skipped slides are not shown in a slide show
        xml = z.read(part)
        el = etree.fromstring(xml)
        groups = read_timing(el)
        start, clicks = click_steps(groups)
        sounds, tr_sound = slide_sounds(z, part, el, groups)
        states = visibility(start, clicks)
        plan.append((part, [make_state_xml(xml, sh, pa) for sh, pa in states]))
        boxes = shape_boxes(slide, W, H)
        notes = ''
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip() if slide.notes_slide.notes_text_frame else ''
        meta.append({
            'number': i + 1,
            'title': slide_title(slide),
            'text': slide_text(slide),
            'notes': notes,
            'transition': el.find('.//p:transition', NS) is not None,
            'clicks': [[e for e in (effect_for_browser(f, boxes) for f in c) if e] for c in clicks],
            'sounds': sounds,
            'transitionSound': tr_sound,
        })
        log(f'  スライド {i + 1}: クリック {len(clicks)} 回' + (f'・音 {len(sounds) + (1 if tr_sound and tr_sound.get("src") else 0)} 個' if sounds or tr_sound else ''))

    tmp = tempfile.mkdtemp(prefix='aialt_')
    # PowerPoint (sandboxed) reads and writes next to the original file.
    work_pptx = os.path.join(os.path.dirname(src), f'.aialt_steps_{os.getpid()}.pptx')
    work_pdf = os.path.join(os.path.dirname(src), f'.aialt_steps_{os.getpid()}.pdf')
    try:
        total = build_expanded(z, plan, work_pptx)
        log(f'PowerPoint で {total} 枚の画像を作成中…')
        powerpoint_pdf(work_pptx, work_pdf)
        subprocess.run(['pdftoppm', '-jpeg', '-jpegopt', f'quality={quality}', '-scale-to-x', str(width), '-scale-to-y', '-1',
                        work_pdf, os.path.join(tmp, 'p')], check=True)
        pages = sorted(f for f in os.listdir(tmp) if f.endswith('.jpg'))
        if len(pages) != total:
            raise SystemExit(f'ページ数が合いません（{len(pages)} / {total}）。')
        k = 0
        slides = []
        for m, (part, states) in zip(meta, plan):
            imgs = []
            for _ in states:
                with open(os.path.join(tmp, pages[k]), 'rb') as f:
                    imgs.append('data:image/jpeg;base64,' + base64.b64encode(f.read()).decode())
                k += 1
            slides.append({**m, 'steps': imgs})
    finally:
        for f in (work_pptx, work_pdf):
            if os.path.exists(f):
                os.remove(f)
        shutil.rmtree(tmp, ignore_errors=True)

    data = {
        'app': 'AI-ALT', 'kind': 'slides', 'version': 1,
        'name': os.path.splitext(os.path.basename(src))[0],
        'aspect': round(W / H, 5),
        'slides': slides,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pptx')
    ap.add_argument('-o', '--out')
    ap.add_argument('--width', type=int, default=1920)
    a = ap.parse_args()
    out = a.out or os.path.splitext(a.pptx)[0] + '.aialt-slides.json'
    log(f'変換中: {os.path.basename(a.pptx)}')
    data = convert(a.pptx, out, a.width)
    steps = sum(len(s['steps']) for s in data['slides'])
    log(f'できました: {out}（スライド {len(data["slides"])} 枚・画像 {steps} 枚・{os.path.getsize(out) // 1024 // 1024} MB）')
    print(out)


if __name__ == '__main__':
    main()
