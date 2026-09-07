from pathlib import Path
R=Path(__file__).resolve().parent
p=R/'mock.js';s=p.read_text(encoding='utf-8').replace("{id,state:s,theme:ctx.theme,lang:ctx.lang}","{id,state:s,theme:ctx.theme,lang:ctx.lang,v:'02'}");p.write_text(s,encoding='utf-8')
p=R/'boot.js';s=p.read_text(encoding='utf-8').replace("const settings={id,state:s,theme:ctx.theme,lang:ctx.lang}","const settings={id,state:s,theme:ctx.theme,lang:ctx.lang,v:'02'}");p.write_text(s,encoding='utf-8')
p=R/'atlas.js';s=p.read_text(encoding='utf-8').replace("{id:s.id,state:settings.state,theme:settings.theme,lang:settings.lang}","{id:s.id,state:settings.state,theme:settings.theme,lang:settings.lang,v:'02'}").replace("{id:settings.id,state:settings.state,theme:settings.theme,lang:settings.lang}","{id:settings.id,state:settings.state,theme:settings.theme,lang:settings.lang,v:'02'}");p.write_text(s,encoding='utf-8')
p=R/'finalize.py';s=p.read_text(encoding='utf-8').replace("30 route/content screens + 2 system reference sheets","30 existing route/content screens, an additional dedicated completed-call view of the same call route, and 2 system reference sheets");p.write_text(s,encoding='utf-8')
for file in ['GUIDELINES.md','PAGE-SPECS.md','README.md']:
 p=R/file;s=p.read_text(encoding='utf-8').replace('161','162').replace('128 browser PNG','132 browser PNG').replace('32 экрана ×','33 экрана ×')
 s=s.replace('30 страниц/типов содержимого в атласе плюс два системных листа.', '30 существующих страниц/типов содержимого, отдельное представление завершённого звонка на том же маршруте и два системных листа — 33 пункта атласа.')
 s=s.replace('30 экранов соответствуют страницам или вариантам публичного контента; ещё два листа', '30 экранов соответствуют страницам или вариантам публичного контента; завершённый звонок дополнительно вынесен в отдельное представление того же маршрута; ещё два листа')
 s=s.replace('30 маршрутных/контентных экранов + 2 системных листа','30 маршрутных/контентных экранов + отдельный завершённый звонок + 2 системных листа')
 s=s.replace('Смена формы/темы сбрасывает пример к выбранному состоянию;', 'Смена страницы или состояния сбрасывает пример; переключение темы сохраняет введённое;')
 p.write_text(s,encoding='utf-8')
p=R/'GUIDELINES.md';s=p.read_text(encoding='utf-8')
s+='''

## 13. Уточнения после ревью — редакция 02

Эти уточнения заменяют прежние текстовые обозначения Theme/Menu. У основного переключателя темы нет видимого текста: луна в светлой теме включает тёмную, солнце в тёмной включает светлую. Используется 24 px outline-иконка внутри 44×44 px кнопки, с aria-label/title, называющими целевую тему. Переключение не сбрасывает форму и текущую прокрутку; меняются семантические токены, логотип и иконка. Клавиатурный фокус остаётся на кнопке.

На ширинах до 1023 px в шапке рядом с темой находится бургер. При открытии он меняется на крестик. Кнопка объявляет Open menu / Close menu, aria-expanded и aria-controls; Escape закрывает меню и возвращает фокус инициатору. Поповер ограничен шириной viewport минус 40 px и высотой viewport минус 104 px, длинная административная навигация прокручивается внутри. На самых узких административных экранах (<360 px) подпись Admin возле логотипа скрыта; административный контекст остаётся в заголовке страницы.

Выбран единый набор [Heroicons 2.2.0 / 24 outline](https://github.com/tailwindlabs/heroicons/tree/v2.2.0/optimized/24/outline): sun, moon, bars-3, x-mark. Оригинальные SVG и MIT-лицензия хранятся в assets/heroicons; геометрия не перерисована. icons.js содержит эти же векторные пути. Использование стандартной библиотеки заменяет временные текстовые обозначения предыдущей редакции.

Один и тот же footer лендинга находится после содержимого на всех экранах продукта: публичных, клиентских, административных, preview и системных. Состав: SHPROHLI / Public beta; FAQ, Support, Block calls; Privacy, Terms, Acceptable Use, Imprint. Сохраняются EN/DE, тема, отступы 40 px desktop / 32×20 px mobile. Footer остаётся в обычном потоке; нижняя панель Review call закрепляется только в пределах формы и не перекрывает footer. Диалог находится над страницей и не получает второй footer.

Завершённый звонок вынесен в самостоятельный пункт атласа и галереи. Production-маршрут остаётся /:locale/app/calls/:id. Основная колонка содержит переключение финального/предварительного транскрипта, реплики, роли, время и действия. Справа — запись, оценка качества, цель и управление данными. Mobile использует одну колонку и ссылку Rate call quality к форме. Форма требует оценку достижения цели; оценка транскрипта доступна только при готовом финальном транскрипте. Комментарий до 500 символов, живой счётчик, явное подтверждение сохранения. Введённые оценки сохраняются в форме после демонстрационного сохранения.
'''
p.write_text(s,encoding='utf-8')
p=R/'PAGE-SPECS.md';s=p.read_text(encoding='utf-8');s+='''

## 18. Изменения редакции 02

Все экраны получили общий footer лендинга. Тема переключается иконкой солнца/луны, планшетная и мобильная навигация открывается бургером; точные размеры и поведение зафиксированы в разделе 13 GUIDELINES.md.

В атласе отдельные пункты «Подготовка и ход звонка» и «Завершённый звонок и оценка качества» показывают один существующий маршрут. Состояние provisional добавлено для просмотра предварительного транскрипта после завершения; оно является состоянием представления, а не новым серверным статусом. Старые ссылки call + completed автоматически направляются к этому представлению. Источник формы оценки — call-feedback.tsx: обязательный goalResult, необязательная оценка готового финального транскрипта, комментарий максимум 500, сохранение/обновление и подтверждение.
''';p.write_text(s,encoding='utf-8')
p=R/'build-docs.py';s=p.read_text(encoding='utf-8').replace('30 экранов существующих маршрутов и контента, 2 системных листа, 161 просмотрочное состояние.', '30 существующих маршрутных/контентных экранов, отдельное представление завершённого звонка, 2 системных листа — 33 пункта и 162 просмотрочных состояния.')
p.write_text(s,encoding='utf-8')
p=R/'package.py';s=p.read_text(encoding='utf-8');a=s.index("summary={'date'");b=s.index("(R/'qa-summary.json')",a)
s=s[:a]+"summary={'date':'2026-09-07','revision':'02','screens':len(manifest['screens']),'routeContentScreens':30,'dedicatedCompletedCallViews':1,'stateEntries':sum(len(x['states']) for x in manifest['screens']),'galleryPng':len(manifest['screens'])*4,'breakpointChecks':99,'contrastChecks':18,'interactionChecks':10,'localHtmlLinks':'pass','productionFilesChanged':False,'status':'Revision 02 ready for design review'}\n"+s[b:]
a=s.index("p=R/'WORK.md'");b=s.index('archive=R/',a);s=s[:a]+s[b:];p.write_text(s,encoding='utf-8')
print('Updated documentation, route compatibility and revision metadata.')
