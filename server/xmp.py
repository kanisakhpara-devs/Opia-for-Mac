"""XMP sidecars: write catalog metadata + develop settings next to the original, and read them back."""
import json
import os
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

from . import core
from .core import api

NS = {
    'x': 'adobe:ns:meta/', 'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'xmp': 'http://ns.adobe.com/xap/1.0/',
    'dc': 'http://purl.org/dc/elements/1.1/', 'crs': 'http://ns.adobe.com/camera-raw-settings/1.0/',
    'lr': 'http://ns.adobe.com/lightroom/1.0/', 'photoshop': 'http://ns.adobe.com/photoshop/1.0/',
    'Iptc4xmpCore': 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/', 'exif': 'http://ns.adobe.com/exif/1.0/',
    'xmpRights': 'http://ns.adobe.com/xap/1.0/rights/', 'opia': 'https://github.com/kanisakhpara-devs/Opia/ns/1.0/',
}
# our develop key -> Camera Raw name, so other raw converters can read the common adjustments
CRS = {
    'exposure': 'Exposure2012', 'contrast': 'Contrast2012', 'highlights': 'Highlights2012', 'shadows': 'Shadows2012',
    'whites': 'Whites2012', 'blacks': 'Blacks2012', 'texture': 'Texture', 'clarity': 'Clarity2012', 'dehaze': 'Dehaze',
    'vibrance': 'Vibrance', 'saturation': 'Saturation', 'temp': 'IncrementalTemperature', 'tint': 'IncrementalTint',
    'sharpAmount': 'Sharpness', 'sharpRadius': 'SharpenRadius', 'sharpDetail': 'SharpenDetail',
    'sharpMasking': 'SharpenEdgeMasking', 'nrLum': 'LuminanceSmoothing', 'nrColor': 'ColorNoiseReduction',
    'vigAmount': 'PostCropVignetteAmount', 'vigMid': 'PostCropVignetteMidpoint', 'vigFeather': 'PostCropVignetteFeather',
    'vigRound': 'PostCropVignetteRoundness', 'grain': 'GrainAmount', 'grainSize': 'GrainSize', 'grainRough': 'GrainFrequency',
    'pcHighlights': 'ParametricHighlights', 'pcLights': 'ParametricLights', 'pcDarks': 'ParametricDarks',
    'pcShadows': 'ParametricShadows', 'tVertical': 'PerspectiveVertical', 'tHorizontal': 'PerspectiveHorizontal',
    'tRotate': 'PerspectiveRotate', 'tAspect': 'PerspectiveAspect', 'tScale': 'PerspectiveScale', 'tX': 'PerspectiveX',
    'tY': 'PerspectiveY', 'distortion': 'LensManualDistortionAmount', 'lensVignette': 'VignetteAmount',
    'calShadowTint': 'ShadowTint', 'calRedHue': 'RedHue', 'calRedSat': 'RedSaturation', 'calGreenHue': 'GreenHue',
    'calGreenSat': 'GreenSaturation', 'calBlueHue': 'BlueHue', 'calBlueSat': 'BlueSaturation',
    'defringePurple': 'DefringePurpleAmount', 'defringeGreen': 'DefringeGreenAmount',
}
HSL_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']
IPTC = {'creator': None, 'copyright': None, 'city': 'photoshop:City', 'state': 'photoshop:State',
        'country': 'photoshop:Country', 'headline': 'photoshop:Headline', 'credit': 'photoshop:Credit',
        'source': 'photoshop:Source', 'instructions': 'photoshop:Instructions', 'jobtitle': 'photoshop:AuthorsPosition',
        'sublocation': 'Iptc4xmpCore:Location', 'countrycode': 'Iptc4xmpCore:CountryCode',
        'genre': 'Iptc4xmpCore:IntellectualGenre', 'usage': 'xmpRights:UsageTerms', 'weburl': 'xmpRights:WebStatement',
        'email': 'Iptc4xmpCore:CiEmailWork', 'phone': 'Iptc4xmpCore:CiTelWork', 'website': 'Iptc4xmpCore:CiUrlWork',
        'address': 'Iptc4xmpCore:CiAdrExtadr', 'event': 'Iptc4xmpCore:Event', 'scene': 'Iptc4xmpCore:Scene',
        'category': 'photoshop:Category', 'transref': 'photoshop:TransmissionReference'}
for _p, _u in NS.items():
    ET.register_namespace(_p, _u)


def sidecar_path(path):
    return os.path.splitext(path)[0] + '.xmp'


def crs_attrs(dev):
    out = {}
    if not dev:
        return out
    for k, name in CRS.items():
        if k in dev and isinstance(dev[k], (int, float)):
            out[name] = '%g' % dev[k]
    hsl = dev.get('hsl') or {}
    for part, crs in (('hue', 'HueAdjustment'), ('sat', 'SaturationAdjustment'), ('lum', 'LuminanceAdjustment')):
        for n, v in zip(HSL_NAMES, hsl.get(part) or []):
            out[crs + n] = '%g' % v
    cg = dev.get('cg') or {}
    for zone, hk, sk, lk in (('shadows', 'SplitToningShadowHue', 'SplitToningShadowSaturation', 'ColorGradeShadowLum'),
                             ('highlights', 'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeHighlightLum'),
                             ('midtones', 'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeMidtoneLum'),
                             ('global', 'ColorGradeGlobalHue', 'ColorGradeGlobalSat', 'ColorGradeGlobalLum')):
        z = cg.get(zone)
        if z:
            out[hk], out[sk], out[lk] = '%g' % z.get('h', 0), '%g' % z.get('s', 0), '%g' % z.get('l', 0)
    if cg:
        out['ColorGradeBlending'] = '%g' % cg.get('blending', 50)
        out['SplitToningBalance'] = '%g' % cg.get('balance', 0)
    if dev.get('treatment') == 'bw':
        out['ConvertToGrayscale'] = 'True'
    c = dev.get('crop')
    if c and (c.get('w', 1) < 0.999 or c.get('h', 1) < 0.999 or c.get('angle')):
        out.update({'HasCrop': 'True', 'CropLeft': '%.6f' % (c['cx'] - c['w'] / 2), 'CropTop': '%.6f' % (c['cy'] - c['h'] / 2),
                    'CropRight': '%.6f' % (c['cx'] + c['w'] / 2), 'CropBottom': '%.6f' % (c['cy'] + c['h'] / 2),
                    'CropAngle': '%g' % c.get('angle', 0)})
    out['ProcessVersion'] = '11.0'
    return out


def build(photo, kw_paths, develop=True, fields='all'):
    """XMP packet for one photo. photo is the UI-shaped dict; kw_paths is a list of ['Parent', 'Child'] lists."""
    iptc = photo.get('iptc') or {}
    attrs = {'xmp:CreatorTool': 'Opia ' + core.VERSION}
    body = []
    limited = fields in ('copyright', 'copyright_contact')
    if not limited:
        if photo.get('rating'):
            attrs['xmp:Rating'] = str(photo['rating'])
        if photo.get('label'):
            attrs['xmp:Label'] = photo['label']
        if photo.get('flag'):
            attrs['opia:Flag'] = str(photo['flag'])
    for key, tag in IPTC.items():
        v = iptc.get(key)
        if not v or not tag:
            continue
        if limited and not (key in ('usage', 'weburl') or (fields == 'copyright_contact' and key in ('email', 'phone', 'website', 'address'))):
            continue
        attrs[tag] = str(v)

    def alt(tag, text):
        body.append('<%s><rdf:Alt><rdf:li xml:lang="x-default">%s</rdf:li></rdf:Alt></%s>' % (tag, escape(text), tag))
    if photo.get('title') and not limited:
        alt('dc:title', photo['title'])
    if photo.get('caption') and not limited:
        alt('dc:description', photo['caption'])
    if iptc.get('copyright'):
        alt('dc:rights', iptc['copyright'])
        attrs['xmpRights:Marked'] = 'True'
    if iptc.get('creator'):
        body.append('<dc:creator><rdf:Seq><rdf:li>%s</rdf:li></rdf:Seq></dc:creator>' % escape(iptc['creator']))
    if kw_paths and not limited:
        flat = []
        for p in kw_paths:
            for name in p:
                if name not in flat:
                    flat.append(name)
        body.append('<dc:subject><rdf:Bag>%s</rdf:Bag></dc:subject>' % ''.join('<rdf:li>%s</rdf:li>' % escape(k) for k in flat))
        body.append('<lr:hierarchicalSubject><rdf:Bag>%s</rdf:Bag></lr:hierarchicalSubject>'
                    % ''.join('<rdf:li>%s</rdf:li>' % escape('|'.join(p)) for p in kw_paths))
    gps = photo.get('gps')
    if gps and fields not in ('copyright', 'copyright_contact', 'no_location'):
        def dm(v, pos, neg):
            a = abs(v)
            return '%d,%.6f%s' % (int(a), (a - int(a)) * 60, pos if v >= 0 else neg)
        attrs['exif:GPSLatitude'], attrs['exif:GPSLongitude'] = dm(gps[0], 'N', 'S'), dm(gps[1], 'E', 'W')
    dev = photo.get('develop')
    if develop and dev and not limited:
        for k, v in crs_attrs(dev).items():
            attrs['crs:' + k] = v
        attrs['opia:Settings'] = json.dumps(dev, separators=(',', ':'))
        curve = (dev.get('curve') or {}).get('rgb')
        if curve:
            body.append('<crs:ToneCurvePV2012><rdf:Seq>%s</rdf:Seq></crs:ToneCurvePV2012>'
                        % ''.join('<rdf:li>%d, %d</rdf:li>' % (round(x), round(y)) for x, y in curve))
    ns = ' '.join('xmlns:%s=%s' % (p, quoteattr(u)) for p, u in NS.items() if p not in ('x', 'rdf'))
    at = '\n   '.join('%s=%s' % (k, quoteattr(v)) for k, v in attrs.items())
    return ('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
            '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Opia %s">\n'
            ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
            '  <rdf:Description rdf:about="" %s\n   %s>\n   %s\n  </rdf:Description>\n'
            ' </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>\n') % (core.VERSION, ns, at, '\n   '.join(body))


def kw_paths_for(cat, photo_ids):
    from .catalog import keyword_path
    cache = {k['id']: k for k in cat.q('SELECT * FROM keywords')}
    out = {}
    marks = ','.join('?' * len(photo_ids))
    for r in cat.q('SELECT photo_id, keyword_id FROM photo_keywords WHERE photo_id IN (%s)' % marks, photo_ids):
        if cache.get(r['keyword_id'], {}).get('export', 1):
            out.setdefault(r['photo_id'], []).append(keyword_path(cat, r['keyword_id'], cache))
    return out


def write_sidecars(ids):
    from .catalog import photos_out
    cat = core.cat()
    photos = [p for p in photos_out(cat, ids) if not p['master_id']]
    kws = kw_paths_for(cat, [p['id'] for p in photos]) if photos else {}
    written = []
    for p in photos:
        folder = os.path.dirname(p['path'])
        if not os.path.isdir(folder):
            continue
        target = sidecar_path(p['path'])
        with open(target, 'w', encoding='utf-8') as f:
            f.write(build(p, kws.get(p['id'], [])))
        written.append(target)
    return written


@api
def xmp_write(ids):
    return {'written': write_sidecars(ids)}


def _q(prefix, name):
    return '{%s}%s' % (NS[prefix], name)


def read_sidecar(path):
    """Parse the sidecar beside an image, if any. Returns only the fields it actually found."""
    side = sidecar_path(path)
    out = {}
    if not os.path.exists(side):
        return out
    try:
        root = ET.parse(side).getroot()
    except (ET.ParseError, OSError):
        return out
    rev = {v: k for k, v in CRS.items()}
    iptc_rev = {}
    for k, tag in IPTC.items():
        if tag:
            p, n = tag.split(':')
            iptc_rev[_q(p, n)] = k
    crs, iptc = {}, {}

    def li(el):
        return [x.text or '' for x in el.iter(_q('rdf', 'li'))]
    for d in root.iter(_q('rdf', 'Description')):
        items = list(d.attrib.items()) + [(c.tag, c.text) for c in d if c.text and c.text.strip() and not len(c)]
        for k, v in items:
            if k == _q('xmp', 'Rating'):
                try:
                    out['rating'] = max(0, min(5, int(float(v))))
                except ValueError:
                    pass
            elif k == _q('xmp', 'Label'):
                out['label'] = v
            elif k == _q('opia', 'Flag'):
                out['flag'] = int(v)
            elif k == _q('opia', 'Settings'):
                try:
                    out['develop'] = json.loads(v)
                except ValueError:
                    pass
            elif k in iptc_rev:
                iptc[iptc_rev[k]] = v
            elif k.startswith('{%s}' % NS['crs']):
                name = k.split('}')[1]
                if name in rev:
                    try:
                        crs[rev[name]] = float(v)
                    except ValueError:
                        pass
                elif name == 'ConvertToGrayscale' and v == 'True':
                    crs['treatment'] = 'bw'
        for c in d:
            if c.tag == _q('dc', 'title') and li(c):
                out['title'] = li(c)[0]
            elif c.tag == _q('dc', 'description') and li(c):
                out['caption'] = li(c)[0]
            elif c.tag == _q('dc', 'rights') and li(c):
                iptc['copyright'] = li(c)[0]
            elif c.tag == _q('dc', 'creator') and li(c):
                iptc['creator'] = li(c)[0]
            elif c.tag == _q('dc', 'subject'):
                out.setdefault('keywords', [])
                out['keywords'] += [k for k in li(c) if k not in out['keywords']]
            elif c.tag == _q('lr', 'hierarchicalSubject'):
                out['hier'] = [k.replace('|', ' > ') for k in li(c)]
    if 'hier' in out:   # hierarchy wins over the flat list so parents are not duplicated at the root
        out['keywords'] = out.pop('hier')
    if iptc:
        out['iptc'] = iptc
    if 'develop' not in out and crs:
        out['develop'] = crs
    return out


@api
def xmp_read(ids):
    """Pull metadata + settings from sidecars back into the catalog."""
    from .catalog import keywords_set, photos_out, photos_update
    cat = core.cat()
    n = 0
    for i in ids:
        r = cat.photo(i)
        s = read_sidecar(r['path'])
        if not s:
            continue
        fields = {k: s[k] for k in ('rating', 'label', 'flag', 'title', 'caption', 'develop', 'iptc') if k in s}
        if fields:
            photos_update([i], fields)
        if s.get('keywords'):
            keywords_set([i], s['keywords'])
        n += 1
    return {'read': n, 'photos': photos_out(cat, ids), 'keywords': cat.q('SELECT * FROM keywords')}
