from pathlib import Path
R=Path(__file__).resolve().parent
for name in ['QA.md','design-qa.md']:
 p=R/name;s=p.read_text(encoding='utf-8')
 for a,b in [('32 листа; 30 маршрутных/контентных экранов, 2 системных','33 листа; 30 маршрутных/контентных экранов, отдельный завершённый звонок и 2 системных'),('161','162'),('128','132'),('96 сочетаний','99 сочетаний'),('all 32 base screens','all 33 base screens'),('96 breakpoint checks','99 breakpoint checks')]:s=s.replace(a,b)
 s=s.replace('текстовые Theme/Menu вместо выдуманных пиктограмм','согласованные иконки Heroicons для темы и меню')
 s=s.replace('text Menu/Theme controls instead of inferred decorative icons','user-requested Heroicons sun/moon and hamburger controls')
 p.write_text(s,encoding='utf-8')
p=R/'QA.md';s=p.read_text(encoding='utf-8');insert='''
## Редакция 02 — правки пользователя

Проверены все четыре правки: солнце/луна, бургер на телефоне и планшете, отдельный завершённый звонок с транскриптами и фидбеком, единый футер лендинга на каждом продуктовом экране. В 132 базовых сочетаниях подтверждены один футер и одинаковый набор из семи ссылок. Видимый переключатель темы везде имеет иконку без текста и область 44×44 px; бургер — 44×44 px на ширинах до 1024 px.

`qa-revision-02.json`: 13 дополнительных проверок пройдены. Проверены открытие меню и замена на X, Escape с возвратом фокуса, клик снаружи, совместимость старой ссылки call/completed, переключение транскриптов, обязательная оценка результата, ограничение оценки качества до готовности финального транскрипта, счётчик комментария, сохранение формы при смене темы, подтверждение отправки, навигация атласа и галерея. Фидбек в макете остаётся демонстрационным.

Визуально просмотрены завершённый звонок в обеих темах, мобильная форма качества, открытое планшетное меню админки и нижние части звонка/админки с футером. Сравнение до/после в одном входе: `revisions/02/before-completed-desktop-light.png` и `screens/call-completed-desktop-light.png`, 1440×1024 CSS px. Сохранены шрифт, палитра, логотип и двухколоночная структура. Изменены согласованные элементы: иконка темы, переключение транскриптов, положение фидбека. Отдельные свидетельства находятся в `revisions/02/`.

При проверке выявлено смешивание старых и новых ресурсов браузерного кэша. Добавлена версия URL для CSS/JS, затем заново пройдены все 33 экрана и 162 состояния. Ошибка загрузки новой функции разрешения экранов устранена. Короткие сообщения системных состояний проверены как непустые; их малая длина сама по себе не является дефектом.

''';s=s.replace('## 1. Выполненные проверки',insert+'## 1. Выполненные проверки');p.write_text(s,encoding='utf-8')
p=R/'design-qa.md';s=p.read_text(encoding='utf-8');insert='''
## Revision 02 review

Result: pass for the four requested design revisions. The before-completed desktop light capture and revised desktop light capture were opened together in one comparison input at 1440×1024 CSS px. The typography, source logo, color tokens, content width and transcript/sidebar split remain consistent. The library moon icon, transcript navigation and earlier feedback position implement the user's requested changes. Dark completed view, mobile feedback and tablet admin menu/footer were inspected separately. Evidence: revisions/02/ and the refreshed screens/ captures.

The shared footer is present exactly once in all 162 states; all 132 baseline captures contain the same seven landing-footer links. The theme button has no visible label and measures 44×44 px, with a 24 px icon. The hamburger has the same target size on all 320/834 px baseline checks. No page-wide horizontal overflow in the 99 breakpoint checks. Thirteen revision-specific interaction checks pass in qa-revision-02.json, in addition to the ten earlier baseline checks. A cache-mixing error discovered during the revision was resolved with versioned CSS/JS URLs before the final capture and state runs.

Full fidelity is assessed against the approved design and the user's four explicit amendments. Footer placement is normal document flow on every product screen, including authentication, preview and admin pages; it does not overlay the call form. Production source and service APIs remain untouched.

''';s=s.replace('## Findings and iteration history',insert+'## Findings and iteration history');p.write_text(s,encoding='utf-8')
p=R/'README.md';s=p.read_text(encoding='utf-8').replace('162 просмотрочный вариант','162 просмотрочных состояния');s=s.replace('Откройте `index.html` для всех макетов.','Редакция 02: иконки солнца/луны и бургер-меню, общий футер, отдельный пункт «Завершённый звонок и оценка качества».\n\nОткройте `index.html` для всех макетов.');p.write_text(s,encoding='utf-8')
p=R/'WORK.md';s=p.read_text(encoding='utf-8');s=s.split('## Завершение')[0]+'''## Завершение — редакция 02

Все этапы завершены для дизайн-ревью. Четыре правки пользователя внесены в автономный атлас. 33 листа, 162 состояния, 132 gallery PNG, 99 проверок ширины, 18 проверок контраста, 13 дополнительных проверок взаимодействий. Результаты и ограничения: QA.md и design-qa.md. Production не изменён. Архив исключает sources/ и рабочие скрипты.
''';p.write_text(s,encoding='utf-8')
p=R/'build-docs.py';s=p.read_text(encoding='utf-8').replace("s.id+'-'+device+'-'+theme+'.png'","s.id+'-'+device+'-'+theme+'.png?v=02b'");s=s.replace('Три обзорные визуальные композиции','Ранние обзорные композиции — до редакции 02');p.write_text(s,encoding='utf-8')
p=R/'revisions/02/after-completed-full-dark.png'
if p.exists():p.rename(p.with_name('after-completed-top-dark.png'))
print('Revision documentation updated.')
