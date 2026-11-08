-- Exact technical copy upgrade; old publications and acceptances remain immutable.
-- Runs atomically under the ordinary migration runner. Empty installations use seeds.
-- Unknown edits in a published target field abort before any publication is committed.
CREATE FUNCTION pg_temp.transcript_copy_leaf(value jsonb, old_values jsonb, replacement text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; pair record;
BEGIN
  IF jsonb_typeof(value) = 'string' THEN
    IF old_values ? (value #>> '{}') THEN RETURN to_jsonb(replacement); END IF;
    RETURN value;
  ELSIF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.transcript_copy_leaf(item,old_values,replacement) ORDER BY n),'[]'::jsonb)
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY a(item,n);
    RETURN result;
  ELSIF jsonb_typeof(value) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(key,pg_temp.transcript_copy_leaf(val,old_values,replacement)),'{}'::jsonb)
      INTO result FROM jsonb_each(value) a(key,val);
    RETURN result;
  END IF;
  RETURN value;
END; $$;

CREATE FUNCTION pg_temp.transcript_copy_contains(value jsonb, expected text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(value)='string' THEN RETURN (value #>> '{}')=expected;
  ELSIF jsonb_typeof(value)='array' THEN
    RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(value) a(item) WHERE pg_temp.transcript_copy_contains(item,expected));
  ELSIF jsonb_typeof(value)='object' THEN
    RETURN EXISTS(SELECT 1 FROM jsonb_each(value) a(key,item) WHERE pg_temp.transcript_copy_contains(item,expected));
  END IF;
  RETURN false;
END; $$;

CREATE FUNCTION pg_temp.transcript_copy_upgrade(value jsonb, group_key text, locale_key text, strict boolean)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE rule jsonb; found boolean;
BEGIN
  FOR rule IN SELECT item FROM jsonb_array_elements($copy$[{"group":"page:privacy","locale":"en","semantic":"retention","old":["Audio retention is selected for each call: delete it as soon as the recording becomes available after the call, or keep it for 7 or 30 days from that moment. Transcription requests and retries never extend this period. The first option still involves temporary recording; it does not delete the transcript. Translation or summary processing does not extend audio retention. Other account and call data, including saved translations and summaries where enabled, is retained while it is needed to provide the service, meet the selected settings, protect the service and comply with applicable obligations."],"next":"New calls keep audio for 30 days from when the recording becomes available. You can delete it earlier. Existing calls retain their saved retention period. Transcription, translation, summary processing and retries never extend the audio deadline. Deleting audio does not delete the saved transcript. Other account and call data, including saved translations and summaries where enabled, is retained while it is needed to provide the service, meet the selected settings, protect the service and comply with applicable obligations."},{"group":"collection:landing","locale":"en","semantic":"retention","old":["Delete audio when it becomes available after the call, or keep it for 7 or 30 days from that moment. Transcription does not extend storage."],"next":"New calls keep audio for 30 days from when the recording becomes available. You can delete it earlier."},{"group":"page:privacy","locale":"de","semantic":"retention","old":["Für jeden Anruf wählen Sie: Aufnahme löschen, sobald sie nach dem Anruf verfügbar ist, oder ab diesem Zeitpunkt 7 oder 30 Tage aufbewahren. Transkriptionsanfragen und Wiederholungen verlängern diese Frist nicht. Auch die erste Option umfasst eine vorübergehende Aufnahme; das Transkript wird dabei nicht gelöscht. Übersetzungen und Zusammenfassungen verlängern die Audioaufbewahrung nicht. Andere Konto- und Anrufdaten, einschliesslich gespeicherter Übersetzungen und Zusammenfassungen bei freigeschalteten Funktionen, werden so lange gespeichert, wie dies für den Dienst, Ihre Einstellungen, den Schutz des Dienstes oder anwendbare Pflichten erforderlich ist."],"next":"Neue Anrufe speichern Audio 30 Tage ab Verfügbarkeit der Aufnahme. Sie können es früher löschen. Bestehende Anrufe behalten ihre gespeicherte Aufbewahrungsfrist. Transkription, Übersetzung, Zusammenfassung und Wiederholungen verlängern die Frist nicht. Das Löschen von Audio löscht das gespeicherte Transkript nicht. Andere Konto- und Anrufdaten, einschliesslich gespeicherter Übersetzungen und Zusammenfassungen bei freigeschalteten Funktionen, werden so lange gespeichert, wie dies für den Dienst, Ihre Einstellungen, den Schutz des Dienstes oder anwendbare Pflichten erforderlich ist."},{"group":"collection:landing","locale":"de","semantic":"retention","old":["Audio löschen, sobald es nach dem Anruf verfügbar ist, oder ab dann 7 oder 30 Tage aufbewahren. Transkription verlängert die Speicherung nicht."],"next":"Neue Anrufe speichern Audio 30 Tage ab Verfügbarkeit der Aufnahme. Sie können es früher löschen."},{"group":"page:privacy","locale":"fr","semantic":"retention","old":["Pour chaque appel, vous choisissez de supprimer l’audio dès que l’enregistrement est disponible après l’appel, ou de le conserver 7 ou 30 jours à partir de ce moment. Les demandes de transcription et les nouvelles tentatives ne prolongent pas ce délai. La première option implique un enregistrement temporaire et ne supprime pas la transcription. Traductions et résumés ne prolongent pas la conservation audio. Les autres données de compte et d’appel, y compris les traductions et résumés enregistrés, sont conservées tant que nécessaire pour fournir le service, respecter vos réglages, protéger le service et remplir les obligations applicables."],"next":"Les nouveaux appels conservent l’audio pendant 30 jours à partir de la disponibilité de l’enregistrement. Vous pouvez le supprimer avant. Les appels existants conservent leur durée enregistrée. La transcription, la traduction, les résumés et les nouvelles tentatives ne prolongent pas ce délai. Supprimer l’audio ne supprime pas la transcription enregistrée. Les autres données de compte et d’appel, y compris les traductions et résumés enregistrés, sont conservées tant que nécessaire pour fournir le service, respecter vos réglages, protéger le service et remplir les obligations applicables."},{"group":"collection:landing","locale":"fr","semantic":"retention","old":["Supprimez l’audio dès sa disponibilité après l’appel, ou conservez-le 7 ou 30 jours à partir de ce moment. La transcription ne prolonge pas ce délai."],"next":"Les nouveaux appels conservent l’audio pendant 30 jours à partir de la disponibilité de l’enregistrement. Vous pouvez le supprimer avant."},{"group":"page:privacy","locale":"it","semantic":"retention","old":["Per ogni chiamata scegli se eliminare l’audio non appena la registrazione è disponibile dopo la chiamata, oppure conservarlo per 7 o 30 giorni da quel momento. Le richieste di trascrizione e i nuovi tentativi non prolungano questo periodo. La prima opzione comporta comunque una registrazione temporanea e non elimina la trascrizione. Traduzioni e riepiloghi non prolungano la conservazione audio. Gli altri dati dell’account e delle chiamate, incluse traduzioni e riepiloghi salvati, sono conservati finché servono per fornire e proteggere il servizio, rispettare le impostazioni e gli obblighi applicabili."],"next":"Le nuove chiamate conservano l’audio per 30 giorni da quando la registrazione è disponibile. Puoi eliminarlo prima. Le chiamate esistenti mantengono il periodo salvato. Trascrizione, traduzione, riepilogo e nuovi tentativi non prolungano la scadenza. Eliminare l’audio non elimina la trascrizione salvata. Gli altri dati dell’account e delle chiamate, incluse traduzioni e riepiloghi salvati, sono conservati finché servono per fornire e proteggere il servizio, rispettare le impostazioni e gli obblighi applicabili."},{"group":"collection:landing","locale":"it","semantic":"retention","old":["Elimina l’audio appena disponibile dopo la chiamata o conservalo per 7 o 30 giorni da quel momento. La trascrizione non prolunga il periodo."],"next":"Le nuove chiamate conservano l’audio per 30 giorni da quando la registrazione è disponibile. Puoi eliminarlo prima."},{"group":"page:privacy","locale":"rm","semantic":"retention","old":["Per mintga telefonat tschernas ti da stizzar l’audio uschespert che la registraziun è disponibla suenter il telefonat, u da conservar el 7 u 30 dis a partir da quel mument. Dumondas da transcripziun e novas emprovas na prolungan betg quest termin. L’emprima opziun cumpiglia tuttina ina registraziun temporara e na stizza betg la transcripziun. Translaziuns e resumaziuns na prolungheschan betg la conservaziun da l’audio. Autras datas dal conto e dals telefonats, inclus translaziuns e resumaziuns memorisadas, restan conservadas uschè ditg sco necessari per porscher e proteger il servetsch, respectar tes parameters ed ademplir las obligaziuns applicablas."],"next":"Novs cloms conservan l’audio 30 dis a partir dal mument che la registraziun è disponibla. Vus pudais al stizzar pli baud. Cloms existents mantegnan lur perioda memorisada. Transcripziun, translaziun, resumaziuns e repetiziuns na prolungheschan betg il termin. Stizzar l’audio na stizza betg la transcripziun memorisada. Autras datas dal conto e dals telefonats, inclus translaziuns e resumaziuns memorisadas, restan conservadas uschè ditg sco necessari per porscher e proteger il servetsch, respectar tes parameters ed ademplir las obligaziuns applicablas."},{"group":"collection:landing","locale":"rm","semantic":"retention","old":["Stizza l’audio uschespert ch’el è disponibel suenter il telefonat, u conserva el 7 u 30 dis a partir da quel mument. La transcripziun na prolunga betg il termin."],"next":"Novs cloms conservan l’audio 30 dis a partir dal mument che la registraziun è disponibla. Vus pudais al stizzar pli baud."},{"group":"page:privacy","locale":"ru","semantic":"retention","old":["Для каждого звонка выбирается срок хранения аудио: удалить сразу после готовности записи по окончании звонка либо хранить 7 или 30 дней с этого момента. Запросы расшифровки и повторные попытки не продлевают этот срок. Первый вариант всё равно предполагает временную запись и не удаляет расшифровку. Перевод и сводки не продлевают срок хранения аудио. Остальные данные аккаунта и звонков, включая сохранённые переводы и сводки, хранятся, пока нужны для работы и защиты сервиса, соблюдения настроек и применимых обязательств."],"next":"Для новых звонков аудио хранится 30 дней с момента доступности записи. Его можно удалить раньше. Для существующих звонков сохраняется выбранный срок. Расшифровка, перевод, резюме и повторные попытки обработки не продлевают срок. Удаление аудио не удаляет сохранённую расшифровку. Остальные данные аккаунта и звонков, включая сохранённые переводы и сводки, хранятся, пока нужны для работы и защиты сервиса, соблюдения настроек и применимых обязательств."},{"group":"collection:landing","locale":"ru","semantic":"retention","old":["Удалить аудио сразу после готовности записи по окончании звонка либо хранить 7 или 30 дней с этого момента. Расшифровка не продлевает хранение."],"next":"Для новых звонков аудио хранится 30 дней с момента доступности записи. Его можно удалить раньше."},{"group":"page:privacy","locale":"uk","semantic":"retention","old":["Для кожного дзвінка обирається строк зберігання аудіо: видалити одразу після готовності запису по завершенні дзвінка або зберігати 7 чи 30 днів із цього моменту. Запити розшифрування та повторні спроби не подовжують цей строк. Перший варіант однаково передбачає тимчасовий запис і не видаляє розшифровку. Переклад і підсумки не подовжують строку зберігання аудіо. Решта даних облікового запису й дзвінків, зокрема збережені переклади та підсумки, зберігаються, доки потрібні для роботи й захисту сервісу, дотримання налаштувань і застосовних зобов’язань."],"next":"Для нових дзвінків аудіо зберігається 30 днів із моменту доступності запису. Його можна видалити раніше. Для наявних дзвінків зберігається обраний строк. Розшифрування, переклад, підсумок і повторні спроби обробки не подовжують строк. Видалення аудіо не видаляє збережену розшифровку. Решта даних облікового запису й дзвінків, зокрема збережені переклади та підсумки, зберігаються, доки потрібні для роботи й захисту сервісу, дотримання налаштувань і застосовних зобов’язань."},{"group":"collection:landing","locale":"uk","semantic":"retention","old":["Видалити аудіо одразу після готовності запису по завершенні дзвінка або зберігати 7 чи 30 днів із цього моменту. Розшифрування не подовжує строк."],"next":"Для нових дзвінків аудіо зберігається 30 днів із моменту доступності запису. Його можна видалити раніше."}]$copy$::jsonb) a(item)
    WHERE item->>'group'=group_key AND (locale_key IS NULL OR item->>'locale'=locale_key)
  LOOP
    found := pg_temp.transcript_copy_contains(value,rule->>'next') OR EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(rule->'old') a(old) WHERE pg_temp.transcript_copy_contains(value,old));
    IF strict AND NOT found THEN
      RAISE EXCEPTION 'RETENTION_COPY_PREFLIGHT: % locale % field % has an unknown edit; review it before rollout',group_key,rule->>'locale',rule->>'semantic';
    END IF;
    value := pg_temp.transcript_copy_leaf(value,rule->'old',rule->>'next');
  END LOOP;
  RETURN value;
END; $function$;

DO $$
DECLARE page record; revision record; localized record; collection record;
  next_id uuid; next_number integer; next_sections jsonb; next_snapshot jsonb; changed boolean;
BEGIN
  LOCK TABLE content_page_revisions, content_page_revision_localizations, content_editorial_revisions IN SHARE ROW EXCLUSIVE MODE;
  FOR page IN SELECT * FROM content_pages WHERE key IN ('privacy') LOOP
    SELECT * INTO revision FROM content_page_revisions WHERE page_id=page.id AND status='published' ORDER BY revision_number DESC LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM content_page_revision_localizations WHERE revision_id=revision.id AND locale IN ('en','de','fr','it','rm','ru','uk')) <> 7 THEN
      RAISE EXCEPTION 'RETENTION_COPY_PREFLIGHT: page % requires all seven locales',page.key;
    END IF;
    changed := false;
    FOR localized IN SELECT * FROM content_page_revision_localizations WHERE revision_id=revision.id LOOP
      next_sections := pg_temp.transcript_copy_upgrade(localized.sections,'page:'||page.key,localized.locale,true);
      changed := changed OR next_sections<>localized.sections;
    END LOOP;
    IF changed THEN
      next_id := gen_random_uuid();
      SELECT max(revision_number)+1 INTO next_number FROM content_page_revisions WHERE page_id=page.id;
      INSERT INTO content_page_revisions(id,page_id,revision_number,status,requires_reacceptance,created_by_user_id,created_at,updated_at,published_at,required_locales)
        VALUES(next_id,page.id,next_number,'published',false,NULL,now(),now(),now(),'["en","de","fr","it","rm","ru","uk"]');
      INSERT INTO content_page_revision_localizations(id,revision_id,locale,title,summary,sections,seo_title,seo_description,source_revision_number,created_at,updated_at)
        SELECT gen_random_uuid(),next_id,locale,title,summary,pg_temp.transcript_copy_upgrade(sections,'page:'||page.key,locale,true),seo_title,seo_description,next_number,now(),now()
          FROM content_page_revision_localizations WHERE revision_id=revision.id;
      UPDATE content_pages SET updated_at=now() WHERE id=page.id;
    END IF;
    -- Keep existing drafts and their metadata; update only recognized old leaves.
    UPDATE content_page_revision_localizations l SET sections=pg_temp.transcript_copy_upgrade(l.sections,'page:'||page.key,l.locale,false),updated_at=now()
      FROM content_page_revisions r WHERE r.id=l.revision_id AND r.page_id=page.id AND r.status='draft'
        AND l.sections<>pg_temp.transcript_copy_upgrade(l.sections,'page:'||page.key,l.locale,false);
  END LOOP;
  FOR collection IN SELECT * FROM content_editorial_collections WHERE key IN ('landing') LOOP
    SELECT * INTO revision FROM content_editorial_revisions WHERE collection_id=collection.id AND status='published' ORDER BY revision_number DESC LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    next_snapshot := pg_temp.transcript_copy_upgrade(revision.snapshot,'collection:'||collection.key,NULL,true);
    IF next_snapshot<>revision.snapshot THEN
      SELECT max(revision_number)+1 INTO next_number FROM content_editorial_revisions WHERE collection_id=collection.id;
      INSERT INTO content_editorial_revisions(id,collection_id,revision_number,status,snapshot,created_by_user_id,created_at,updated_at,published_at,required_locales)
        VALUES(gen_random_uuid(),collection.id,next_number,'published',next_snapshot,NULL,now(),now(),now(),'["en","de","fr","it","rm","ru","uk"]');
      UPDATE content_editorial_collections SET updated_at=now() WHERE id=collection.id;
    END IF;
    UPDATE content_editorial_revisions SET snapshot=pg_temp.transcript_copy_upgrade(snapshot,'collection:'||collection.key,NULL,false),updated_at=now()
      WHERE collection_id=collection.id AND status='draft' AND snapshot<>pg_temp.transcript_copy_upgrade(snapshot,'collection:'||collection.key,NULL,false);
  END LOOP;
END; $$;
DROP FUNCTION pg_temp.transcript_copy_upgrade(jsonb,text,text,boolean);
DROP FUNCTION pg_temp.transcript_copy_contains(jsonb,text);
DROP FUNCTION pg_temp.transcript_copy_leaf(jsonb,jsonb,text);
