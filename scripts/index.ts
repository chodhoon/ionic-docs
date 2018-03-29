import * as fs from 'fs';
import * as path from 'path';
import * as Git from 'nodegit';
// import * as glob from 'glob';
import * as config from './config';
import * as git from './git';
import * as npm from './npm';
import * as utils from './utils';

const markdownGlob = `ionic/${config.CORE_SRC}/**/readme.md`;
const menuPath = 'src/components/site-menu';

const startTime = new Date().getTime();


// the main task of the API documentation generation process
async function run() {
  utils.vlog('Starting CI task');
  if (!utils.preCheck()) {
    console.error('API Docs Precheck Failure. Check configs and readme.');
    return;
  } else {
    utils.vlog('Precheck complete');
  }

  // clone/update the git repo and get a list of all the tags
  const repo = await git.initRepoRefference();
  utils.vlog('validating tags');
  const versions = await git.getVersions();

  // generate the docs for each version
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i].replace('v', '');
    const DOCS_DEST = path.join(config.API_DOCS_DIR, version);
    // skip this version if it already exists.
    // delete the directory in src/api/ to force a rebuild
    if (fs.existsSync(DOCS_DEST)) {
      console.log(`Skipping existing API docs for ${versions[i]}`);
      continue;
    }

    // Generate the docs for this version
    console.log(`Generating API docs for ${versions[i]} (1-3 mins)`);
    await git.checkout(versions[i]);
    await npm.install();
    await npm.buildAPIDocs();
    const files = await utils.promisedGlob(markdownGlob);

    await copyFiles(files, DOCS_DEST, version);

    generateNav(
      path.join(config.PATH_DOCS, menuPath, `api-menu.ts`),
      files,
      version
    );
  }

  const endTime = new Date().getTime();
  console.log(`Docs copied in ${endTime - startTime}ms`);
}

// Upsert the given version's navigation
function generateNav(menuPath, files, version) {
  let file = fs.readFileSync(menuPath).toString('utf8');
  file = file.replace('export let apiMenu = ', '');

  const menu = JSON.parse(file);

  const components = {};
  for (let i = 0; i < files.length; i++) {
    const componentName = utils.filterParentDirectory(files[i]);
    components[componentName] = `/docs/api/${version}/${componentName}`;
  }

  menu[version] = components;
  const ts = `export let apiMenu = ${JSON.stringify(menu, null, '  ')}`;
  fs.writeFileSync(menuPath, ts);
}

// copy demos and API docs files over to docs-content/api
function copyFiles(files, dest, version = 'latest') {
  utils.vlog(`Copying ${files.length} files`);
  let hasDemo = false;

  for (let i = 0; i < files.length; i++) {
    const componentName = utils.filterParentDirectory(files[i]);
    const markdownName = `${componentName}.md`;
    const demoName = `${componentName}.html`;

    // copy demo if it exists and update the ionic path
    hasDemo = utils.copyFileSync(
      path.join(files[i].replace('/readme.md', ''), 'test/preview/index.html'),
      path.join(dest, demoName),
      file => {
        return file.replace(
          '/dist/ionic.js',
          `https://unpkg.com/@ionic/core@${version}/dist/ionic.js`
        );
      }
    );

    // copying component markdown
    utils.vlog('Copying file: ', markdownName);
    utils.copyFileSync(
      files[i],
      path.join(dest, markdownName),
      file => {
        let header = '---';
        if (hasDemo) {
          header += '\r\n';
          header += `previewUrl: '/docs/docs-content/api/${version}/${demoName}'`;
        }
        header += '\r\n' + '---' + '\r\n\r\n';
        return header + file;
      }
    );
  }
}

// Invoke run() only if executed directly i.e. `node ./scripts/e2e`
if (require.main === module) {
  run()
    .then(() => {
      // do nothing
    })
    .catch(err => {
      console.log(err);
      // fail with non-zero status code
      process.exit(1);
    });
}
