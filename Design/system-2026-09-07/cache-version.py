from pathlib import Path
import re
R=Path(__file__).resolve().parent
for p in R.glob('*.html'):
 s=p.read_text(encoding='utf-8')
 s=re.sub(r'((?:src|href)="[a-z-]+\.(?:css|js))(?:\?v=[^"]+)?"',r'\1?v=02b"',s)
 p.write_text(s,encoding='utf-8')
print('Stamped static resources for revision 02.')
