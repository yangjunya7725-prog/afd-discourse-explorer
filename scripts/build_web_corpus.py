from __future__ import annotations
import base64, gzip, json, re, urllib.request
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.build_corpus'
SRC = WORK / 'sources'
OUT = WORK / 'data'
SRC.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

DOCS = [
    dict(year=2013, filename='afd_1.pdf', url='https://www.abgeordnetenwatch.de/sites/default/files/election-program-files/afd_1.pdf', short='Bundestagswahlprogramm 2013', title='Wahlprogramm. Parteitagsbeschluss vom 14.04.2013', type='联邦议院选举纲领', role='核心语料：早期基准', page_offset=0),
    dict(year=2014, filename='AfD-Europaprogramm_Langfassung.pdf', url='https://www.abgeordnetenwatch.de/sites/default/files/election-program-files/afd-europawahl-2014.pdf', short='Europawahlprogramm 2014', title='Mut zu Deutschland. Für ein Europa der Vielfalt', type='欧洲议会选举纲领', role='过程文本：危机前欧洲观', page_offset=0),
    dict(year=2016, filename='2016-06-27_afd-grundsatzprogramm_web-version.pdf', url='https://www.afd.de/wp-content/uploads/2023/05/Programm_AfD_Online_.pdf', short='Grundsatzprogramm 2016', title='Programm für Deutschland. Das Grundsatzprogramm der Alternative für Deutschland', type='基本纲领', role='过程文本：框架系统化', page_offset=0),
    dict(year=2017, filename='2017-06-01_AfD-Bundestagswahlprogramm_Onlinefassung.pdf', url='https://www.afd.de/wp-content/uploads/2017/06/2017-06-01_AfD-Bundestagswahlprogramm_Onlinefassung.pdf', short='Bundestagswahlprogramm 2017', title='Programm für Deutschland. Wahlprogramm der Alternative für Deutschland für die Wahl zum Deutschen Bundestag', type='联邦议院选举纲领', role='核心语料：转变节点', page_offset=0),
    dict(year=2021, filename='20210611_AfD_Programm_2021.pdf', url='https://www.afd.de/wp-content/uploads/2021/06/20210611_AfD_Programm_2021.pdf', short='Bundestagswahlprogramm 2021', title='Programm der Alternative für Deutschland für die Wahl zum 20. Deutschen Bundestag', type='联邦议院选举纲领', role='核心语料：框架延续', page_offset=0),
    dict(year=2025, filename='AfD_Bundestagswahlprogramm2025_web.pdf', url='https://www.afd.de/wp-content/uploads/2025/02/AfD_Bundestagswahlprogramm2025_web.pdf', short='Bundestagswahlprogramm 2025', title='Zeit für Deutschland. Programm der Alternative für Deutschland für die Wahl zum 21. Deutschen Bundestag', type='联邦议院选举纲领', role='核心语料：最新节点', page_offset=-1),
]

TOPIC_TERMS = {
    '人民与民主': ['volk','staatsvolk','volkssouver','bürger','volksabst','demokratie','wähler','volksentscheid'],
    '主权与国家': ['souverän','souveraen','nationalstaat','eigenstaat','hoheitsrecht','selbstbestimmung','staatsgebiet','grenzregime'],
    '欧洲与欧盟': ['europ','eu ','eu-','brüssel','mitgliedstaat','lissabon','maastricht','eurozone','union'],
    '移民与庇护': ['migration','migrant','einwander','zuwander','asyl','flücht','fluecht','abschieb','remigration','grenzkontroll'],
    '文化与身份': ['kultur','identität','identitaet','leitkultur','sprache','geschichte','christ','islam','heimat','nation'],
    '精英与代表': ['politische klasse','oligarch','berufspolit','parteien','volksvertreter','abgeordnete','politisches kartell','eliten','repräsent'],
}
DIM_TERMS = {
    '成员资格｜Who belongs?': ['einwander','zuwander','integration','staatsangehör','staatsangehoer','leitkultur','islam','kultur','identität','identitaet','sprache','abstamm','heimat','assimilation'],
    '政治代表｜Who represents?': ['politische klasse','oligarch','berufspolit','volksvertreter','parteien','abgeordnete','politisches kartell','eliten','wähler','waehler','direkte demokratie','volksabst'],
    '最终决定权｜Who decides?': ['souverän','souveraen','volkssouver','hoheitsrecht','nationalstaat','eu ','eu-','brüssel','mitgliedstaat','grenze','selbstbestimmung','entscheiden','zustimmung des volkes'],
}
QUERY_EXPANSION = {
    '人民':['volk','staatsvolk','bürger','wähler'], '人民主权':['volkssouveränität','souverän','volk'],
    '公民':['bürger','wähler'], '主权':['souveränität','souverän','hoheitsrechte','selbstbestimmung'],
    '国家':['staat','nationalstaat','deutschland'], '欧盟':['eu','europäische union','brüssel'], '欧洲':['europa','europäische'],
    '移民':['migration','migrant','einwanderung','zuwanderung'], '庇护':['asyl','flüchtling'], '难民':['flüchtling','asyl'],
    '文化':['kultur','leitkultur'], '身份':['identität','kulturelle identität'], '语言':['sprache','deutsche sprache'],
    '伊斯兰':['islam','muslime'], '精英':['eliten','politische klasse','oligarchie','berufspolitiker'],
    '代表':['volksvertreter','abgeordnete','parteien','politische klasse'], '决定权':['souveränität','hoheitsrechte','entscheiden','selbstbestimmung'],
    '入籍':['einbürgerung','staatsangehörigkeit'], '边境':['grenze','grenzkontrolle','grenzsicherung'],
    'belong':['integration','staatsangehörigkeit','leitkultur','kultur'], 'represent':['volksvertreter','politische klasse','abgeordnete'],
    'decide':['souveränität','selbstbestimmung','hoheitsrechte'],
}

def download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 10000:
        return
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 AfD-Discourse-Explorer/1.0'})
    with urllib.request.urlopen(req, timeout=90) as r, open(path, 'wb') as f:
        f.write(r.read())
    if path.stat().st_size < 10000:
        raise RuntimeError(f'Download looks invalid: {url}')

def norm(s: str) -> str:
    s = s.replace('\u00ad','')
    s = re.sub(r'(?<=\w)-\s+(?=\w)', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def is_heading(t: str) -> bool:
    if len(t) > 125 or len(t) < 3:
        return False
    letters = [c for c in t if c.isalpha()]
    upper = sum(c.isupper() for c in letters)/(len(letters) or 1)
    return upper > .72 or bool(re.match(r'^\d+(?:\.\d+){0,3}\s', t)) or bool(re.match(r'^(KAPITEL|ZEIT FÜR|PROGRAMM|WAHLPROGRAMM)', t, re.I))

def tag(text: str, mapping: dict[str,list[str]]) -> list[str]:
    lo = text.lower()
    return [label for label, terms in mapping.items() if any(term in lo for term in terms)]

entries=[]
summaries=[]
entry_id=1
for m in DOCS:
    path = SRC / m['filename']
    download(m['url'], path)
    doc = fitz.open(path)
    current_heading=''
    n=0
    for pidx in range(doc.page_count):
        pdf_page=pidx+1
        printed_page = pdf_page + m['page_offset'] if not (m['year']==2025 and pdf_page<3) else None
        blocks=sorted(doc[pidx].get_text('blocks'), key=lambda b:(round(b[1],1),b[0]))
        for b in blocks:
            t=norm(b[4])
            if not t or re.fullmatch(r'\d{1,3}',t) or re.match(r'^Seite\s+\d+',t,re.I):
                continue
            if re.match(r'^\d+\s+(Programm für Deutschland|Wahlprogramm Bundestagswahl|Migration, Asyl|EU und Europa|Kultur|Demokratie)',t,re.I):
                continue
            if is_heading(t):
                current_heading=t[:160]
                continue
            if len(t)<45:
                continue
            entries.append({
                'id':entry_id,'year':m['year'],'document':m['short'],'title':m['title'],'type':m['type'],'role':m['role'],
                'pdf_page':pdf_page,'page':printed_page,'heading':current_heading,'text':t,
                'topics':tag(t,TOPIC_TERMS),'dimensions':tag(t,DIM_TERMS),'source':m['filename']
            })
            entry_id+=1; n+=1
    summaries.append({**{k:m[k] for k in ['year','short','title','type','role','filename']},'pages':doc.page_count,'entries':n})

payload={'documents':summaries,'entries':entries,'query_expansion':QUERY_EXPANSION}
raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode('utf-8')
encoded=base64.b64encode(gzip.compress(raw,compresslevel=9)).decode('ascii')
(OUT/'corpus.json.gz.b64').write_text(encoded,encoding='ascii')
print(f'Built {len(entries)} searchable units across {sum(d["pages"] for d in summaries)} PDF pages; payload={len(encoded)} chars')
