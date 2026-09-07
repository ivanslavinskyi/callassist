from pathlib import Path
R=Path(__file__).resolve().parent
p=R/'mock.js';s=p.read_text(encoding='utf-8')
s=s.replace("${link(T('2 call credits','2 Anrufguthaben'),'account','usage','credits')}","${ctx.id.startsWith('admin-')?'':link(T('2 call credits','2 Anrufguthaben'),'account','usage','credits')}")
s=s.replace("${link(T('How it works','So funktioniert es'),'landing')}",'''<a href="${href('landing')}#how-it-works">${T('How it works','So funktioniert es')}</a>''')
p.write_text(s,encoding='utf-8')
p=R/'customer.js';s=p.read_text(encoding='utf-8');s=s.replace('esc(n.href)','esc(n.href+(n.href.startsWith(\'mock.html\')?\'&theme=\'+ctx.theme:\'\'))');p.write_text(s,encoding='utf-8')
p=R/'admin.js';s=p.read_text(encoding='utf-8')
s=s.replace("['Status',badge('Active')],['Phone verification'", "['Status',badge(state('restore')?'Suspended':'Active',state('restore')?'danger':'')],['Phone verification'")
s=s.replace("['Account deletion','Not requested']", "['Account deletion',state('restart-deletion')?'Support required':'Not requested']")
s=s.replace("${btn('Suspend account','suspend','danger')}${btn('Restore access','restore')}", "${state('restore')?btn('Restore access','restore'):btn('Suspend account','suspend','danger')}")
s=s.replace("${btn('Restart exhausted deletion','restart-deletion','danger')}", "${state('restart-deletion')?btn('Restart exhausted deletion','restart-deletion','danger'):''}")
p.write_text(s,encoding='utf-8')
print('Refined header, document links and conditional admin controls.')
