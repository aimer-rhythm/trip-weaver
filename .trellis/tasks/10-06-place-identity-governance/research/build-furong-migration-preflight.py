from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'migrate-mention-fact-exclusions.py').read_text(encoding='utf-8')
s=s.replace('字段审核可空列','原文警示可空列').replace('fact_exclusions','text_warnings')
s=s.replace("expression = \"to_jsonb(t) - 'text_warnings'\" if table == 'place_mention_assignment'", "expression = \"to_jsonb(t) - 'text_warnings'\" if table == 'place_identity_scope'")
s=s.replace("get_columns('place_mention_assignment')", "get_columns('place_identity_scope')")
s=s.replace('place_mention_assignment.text_warnings','place_identity_scope.text_warnings')
s=s.replace('SELECT id,text_warnings FROM place_mention_assignment','SELECT id,text_warnings FROM place_identity_scope')
s=s.replace("'place_identity_scope', 'place_identity_scope_source', 'place_mention_assignment', 'place_image_assignment']", "'place_identity_scope', 'place_identity_scope_source', 'place_mention_assignment', 'place_image_assignment',\n          'canonical_place', 'place_mention', 'raw_note', 'place_summary']")
s=s.replace('mention-fact-exclusions-migration','note-text-warning-migration')
with (root/'migrate-note-text-warnings.py').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-remaining-streets-photo-preflight.test.mts').read_text(encoding='utf-8')
s=s.replace('第62批','第63批').replace('五个街道廊道及店铺主体','芙蓉街').replace('batch-61','batch-62').replace('remaining-streets','furong').replace('batch:62','batch:63').replace('fullCityAfterEntityBatch:61','fullCityAfterEntityBatch:62').replace('assert.equal(queued,5)','assert.equal(queued,1)')
a=s.index("['747792");b=s.index('.includes(p.id)',a);s=s[:a]+"['747792d1b5834255f5feaa6c2dc62925']"+s[b:]
a=s.index("['芙蓉街'");b=s.index(') {',a);s=s[:a]+"['芙蓉街']"+s[b:]
with (root/'verify-furong-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(s)
with (root/'upstream-install-before-note-warning.json').open('xb') as f:f.write((root/'upstream-install.json').read_bytes())
