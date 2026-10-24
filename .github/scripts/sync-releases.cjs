const fs = require('node:fs');
const path = require('node:path');

function releasePlan(root = process.cwd()) {
  const readMarkdown = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'agent/package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const currentTag = `v${version}`;
  const notes = new Map();
  const archive = path.join(root, 'docs/releases');
  for (const file of fs.readdirSync(archive).sort()) {
    if (/^v\d+\.\d+\.\d+\.md$/.test(file)) notes.set(file.slice(0, -3), readMarkdown(path.join(archive, file)));
  }
  const current = readMarkdown(path.join(root, 'RELEASE_NOTES.md'));
  if (notes.has(currentTag) && notes.get(currentTag) !== current) throw new Error('Current and archived release notes must match');
  notes.set(currentTag, current);
  for (const [tag, body] of notes) {
    if (!/^## English\s*$/m.test(body) || !/^## Русский\s*$/m.test(body)) throw new Error(`Missing English/Russian sections in ${tag}`);
    if (!body.startsWith(`# Aegis ${tag}\n`)) throw new Error(`Release note title does not match ${tag}`);
  }
  return { currentTag, notes };
}

module.exports = async ({ github, context, core }) => {
  // Validate every document before making any API changes.
  const { currentTag, notes } = releasePlan();
  for (const [tag, body] of notes) {
    let existing;
    try { existing = (await github.rest.repos.getReleaseByTag({ ...context.repo, tag })).data; }
    catch (error) { if (error.status !== 404) throw error; }
    if (existing) {
      if (existing.body !== body) {
        await github.rest.repos.updateRelease({ ...context.repo, release_id: existing.id, body });
        core.info(`Updated bilingual description: ${tag}`);
      }
    } else if (tag === currentTag) {
      await github.rest.repos.createRelease({ ...context.repo, tag_name: tag, target_commitish: context.sha, name: `Aegis ${tag}`, body, draft: false, prerelease: false });
    } else {
      core.info(`Skipping missing historical release: ${tag}`);
    }
  }
};
module.exports.releasePlan = releasePlan;
