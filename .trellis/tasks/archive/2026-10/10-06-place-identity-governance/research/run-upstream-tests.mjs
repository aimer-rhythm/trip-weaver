import {Client} from 'pg';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const database = `place_identity_test_${Date.now()}`;
const warningFixture = process.argv.includes('--note-warning-test') ? new URL(`note-warning-preview-${Date.now()}/`, import.meta.url) : null;
if (warningFixture) fs.mkdirSync(warningFixture);
const relationFixture = process.argv.includes('--relation-preview')
  ? new URL(`mention-relations-preview-${Date.now()}/`, import.meta.url) : null;
if (relationFixture) fs.mkdirSync(relationFixture);
const factFixture = process.argv.includes('--fact-preview') ? new URL(`fact-exclusion-preview-${Date.now()}/`, import.meta.url) : null;
if (factFixture) fs.mkdirSync(factFixture);
const descriptionFixture = process.argv.includes('--description-preview') ? new URL(`description-exclusion-preview-${Date.now()}/`, import.meta.url) : null;
if (descriptionFixture) fs.mkdirSync(descriptionFixture);
const testRoot = process.argv.includes('--installed') ? 'D:/Project/xhs-travel-pipeline/tests'
  : '.trellis/tasks/10-06-place-identity-governance/research/upstream/tests';
const admin = new Client({connectionString:'postgres://postgres@127.0.0.1:18798/postgres'});
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
try {
  const logName=`upstream-${process.argv.includes('--installed')?'installed':process.argv.includes('--full')?'full':'stage'}-${database}.log`;
  const output=fs.createWriteStream(new URL(logName,import.meta.url),{flags:'wx'});
  const child = spawn('D:/Project/xhs-travel-pipeline/.venv/Scripts/python.exe',
    process.argv.includes('--wuhou-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-wuhou.py'] :
    process.argv.includes('--jinli-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-jinli.py'] :
    process.argv.includes('--heming-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-heming.py'] :
    process.argv.includes('--chengdu-renmin-category-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-chengdu-renmin-category.py'] :
    process.argv.includes('--chengdu-common-point-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-chengdu-common-point.py'] :
    process.argv.includes('--chengdu-park-zones-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-chengdu-park-zones.py'] :
    process.argv.includes('--bridge-text-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-bridge-text.py'] :
    process.argv.includes('--last-restaurants-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-last-restaurants.py'] :
    process.argv.includes('--furong-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-furong.py'] :
    process.argv.includes('--remaining-streets-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-remaining-streets.py'] :
    process.argv.includes('--built-place-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-built-place.py'] :
    process.argv.includes('--remaining-food-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-remaining-food.py'] :
    process.argv.includes('--night-market-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-night-market.py'] :
    process.argv.includes('--river-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-river.py'] :
    process.argv.includes('--restaurant-branches-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-restaurant-branches.py'] :
    process.argv.includes('--park-culture-v2-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-park-culture-v2.py'] :
    process.argv.includes('--park-culture-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-park-culture.py'] :
    process.argv.includes('--laoshe-v2-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-laoshe-v2.py'] :
    process.argv.includes('--laoshe-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-laoshe.py'] :
    process.argv.includes('--beverage-branches-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-beverage-branches.py'] :
    process.argv.includes('--food-branches-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-food-branches.py'] :
    process.argv.includes('--qinji-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-qinji.py'] :
    process.argv.includes('--food-address-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-food-address.py'] :
    process.argv.includes('--vintage-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-vintage.py'] :
    process.argv.includes('--qushui-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-qushui.py'] :
    process.argv.includes('--pearl-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-pearl.py'] :
    process.argv.includes('--minzu-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-minzu.py'] :
    process.argv.includes('--qualified-light-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-qualified-light.py'] :
    process.argv.includes('--commercial-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-commercial.py'] :
    process.argv.includes('--shared-routes-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-shared-routes.py'] :
    process.argv.includes('--main-sights-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-main-sights.py'] :
    process.argv.includes('--daminghu-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-daminghu.py'] :
    process.argv.includes('--platform-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-platform.py'] :
    process.argv.includes('--description-data-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-description-data.py'] :
    process.argv.includes('--lingyan-duration-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-lingyan-duration.py'] :
    process.argv.includes('--spring-category-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-spring-categories.py'] :
    process.argv.includes('--spring-duration-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-spring-durations.py'] :
    process.argv.includes('--square-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-square.py'] :
    process.argv.includes('--baotu-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-baotu.py'] :
    process.argv.includes('--wulongtan-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-wulongtan.py'] :
    process.argv.includes('--non-place-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-non-place.py'] :
    process.argv.includes('--wrongcity-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-wrongcity.py'] :
    process.argv.includes('--creation-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-entity-creation.py'] :
    process.argv.includes('--coffee-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-joint-coffee.py',
      ...(process.argv.includes('--staged') ? ['--staged'] : [])] :
    process.argv.includes('--joint-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-joint-scope.py'] :
    process.argv.includes('--scope-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-scope-459.py',
      ...(process.argv.includes('--staged') ? ['--staged'] : [])] :
    process.argv.includes('--batch-preview') ? ['.trellis/tasks/10-06-place-identity-governance/research/all-cities/preview-batch.py',
      process.argv[process.argv.indexOf('--batch-preview') + 1] || 'batch-01', ...(process.argv.includes('--staged') ? ['--staged'] : [])] :
    process.argv.includes('--preview') ? ['.trellis/tasks/10-06-place-identity-governance/research/preview-upstream-data.py'] :
    ['.trellis/tasks/10-06-place-identity-governance/research/test-upstream-stage.py',
     ...(process.argv.includes('--installed') ? ['--installed'] : []),
     process.argv.includes('--operational-preservation-test') ? `${testRoot}/test_operational_preservation_db.py` :
     process.argv.includes('--profile-preservation-test') ? `${testRoot}/test_profile_scope_preservation_db.py` :
     process.argv.includes('--planning-test') ? `${testRoot}/test_planning_exclusion_db.py` :
     warningFixture ? `${testRoot}/test_note_text_warnings_db.py` : descriptionFixture ? `${testRoot}/test_mention_description_exclusion_db.py` : factFixture ? `${testRoot}/test_mention_fact_exclusion_db.py` : relationFixture ? `${testRoot}/test_relation_snapshot_db.py` :
     process.argv.includes('--full') ? 'D:/Project/xhs-travel-pipeline/tests' :
     testRoot],
    {env:{...process.env, PYTHONIOENCODING:'utf-8',
      ...(warningFixture ? {NOTE_WARNING_FIXTURE_DIR: (await import('node:url')).fileURLToPath(warningFixture)} : {}),
      ...(relationFixture ? {RELATION_FIXTURE_DIR: (await import('node:url')).fileURLToPath(relationFixture)} : {}),
      ...(factFixture ? {FACT_FIXTURE_DIR: (await import('node:url')).fileURLToPath(factFixture)} : {}),
      ...(descriptionFixture ? {DESCRIPTION_FIXTURE_DIR: (await import('node:url')).fileURLToPath(descriptionFixture)} : {}),
      IDENTITY_TEST_DATABASE_URL:`postgresql+asyncpg://postgres@127.0.0.1:18798/${database}`},
     windowsHide:true, stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  process.exitCode = await new Promise((resolve,reject)=>{child.on('error',reject); child.on('close',resolve);});
  await new Promise(resolve=>output.end(resolve));
  console.log(JSON.stringify({log:logName,exitCode:process.exitCode, ...(relationFixture ? {relationFixture: relationFixture.href} : {}),
    ...(warningFixture ? {warningFixture: warningFixture.href} : {}),
    ...(factFixture ? {factFixture: factFixture.href} : {}),
    ...(descriptionFixture ? {descriptionFixture: descriptionFixture.href} : {})}));
} finally {
  if (!/^place_identity_test_\d+$/.test(database)) throw new Error('临时库名称不合法');
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
