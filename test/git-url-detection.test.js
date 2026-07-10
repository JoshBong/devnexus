import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isGitUrl, repoDirFromUrl } from '../src/lib/git.js';

describe('isGitUrl', () => {
  it('accepts https URLs', () => {
    assert.equal(isGitUrl('https://github.com/user/repo.git'), true);
    assert.equal(isGitUrl('https://github.com/user/repo'), true);
    assert.equal(isGitUrl('http://git.example.com/user/repo.git'), true);
  });

  it('accepts SCP-style SSH URLs', () => {
    assert.equal(isGitUrl('git@github.com:user/repo.git'), true);
    assert.equal(isGitUrl('git@github.com:user/repo'), true);
    assert.equal(isGitUrl('git@gitlab.self-hosted.internal:group/sub/repo.git'), true);
  });

  it('accepts ssh:// scheme URLs (the bug that caused this fix)', () => {
    assert.equal(isGitUrl('ssh://git@github.com/user/repo.git'), true);
    assert.equal(isGitUrl('ssh://git@gitlab.com:22/user/repo.git'), true);
  });

  it('accepts git:// and git+ssh:// scheme URLs', () => {
    assert.equal(isGitUrl('git://github.com/user/repo.git'), true);
    assert.equal(isGitUrl('git+ssh://git@github.com/user/repo.git'), true);
  });

  it('rejects folder names and paths', () => {
    assert.equal(isGitUrl('my-repo'), false);
    assert.equal(isGitUrl('./local/path'), false);
    assert.equal(isGitUrl('/absolute/path'), false);
    assert.equal(isGitUrl(''), false);
  });

  it('rejects non-URL strings that look URL-ish', () => {
    assert.equal(isGitUrl('git'), false);
    assert.equal(isGitUrl('git@'), false);
    assert.equal(isGitUrl('httpotamus'), false);
  });

  it('handles non-string input safely', () => {
    assert.equal(isGitUrl(null), false);
    assert.equal(isGitUrl(undefined), false);
    assert.equal(isGitUrl(42), false);
  });
});

describe('repoDirFromUrl', () => {
  it('strips .git suffix from https URLs', () => {
    assert.equal(repoDirFromUrl('https://github.com/user/repo.git'), 'repo');
    assert.equal(repoDirFromUrl('https://github.com/user/repo'), 'repo');
  });

  it('extracts repo name from SCP-style SSH URLs', () => {
    assert.equal(repoDirFromUrl('git@github.com:user/repo.git'), 'repo');
    assert.equal(repoDirFromUrl('git@github.com:user/repo'), 'repo');
    assert.equal(repoDirFromUrl('git@gitlab.internal:group/sub/project.git'), 'project');
    assert.equal(repoDirFromUrl('git@host:repo.git'), 'repo');
  });

  it('extracts repo name from ssh:// URLs', () => {
    assert.equal(repoDirFromUrl('ssh://git@github.com/user/repo.git'), 'repo');
    assert.equal(repoDirFromUrl('ssh://git@gitlab.com:22/user/repo.git'), 'repo');
  });

  it('extracts repo name from git:// and git+ssh:// URLs', () => {
    assert.equal(repoDirFromUrl('git://github.com/user/repo.git'), 'repo');
    assert.equal(repoDirFromUrl('git+ssh://git@github.com/user/repo.git'), 'repo');
  });
});
