'use strict';

const assert = require('assert');
const { isMatch, makeRe, parse } = require('..');

describe('options.maxExtglobRecursion', () => {
  it('should literalize risky repeated extglobs by default', () => {
    assert.strictEqual(
      makeRe('+(a|aa)').source,
      '^(?:\\+\\(a\\|aa\\))$'
    );
    assert.strictEqual(
      makeRe('+(*|?)').source,
      '^(?:\\+\\(\\*\\|\\?\\))$'
    );
    assert.strictEqual(
      makeRe('+(+(a))').source,
      '^(?:\\+\\(\\+\\(a\\)\\))$'
    );
    assert.strictEqual(
      makeRe('*(+(a))').source,
      '^(?:\\*\\(\\+\\(a\\)\\))$'
    );

    assert(!isMatch('a'.repeat(20) + 'b', '+(a|aa)'));
    assert(!isMatch('a'.repeat(12) + '!', '+(+(a))'));
  });

  it('should preserve non-risky extglobs by default', () => {
    assert(isMatch('abcabc', '+(abc)'));
    assert(isMatch('foobar', '*(foo|bar)'));
    assert(isMatch('a', '(a|@(b|c)|d)'));
    assert(isMatch('fffooo', '*(*(f)*(o))'));
    assert(isMatch('abc', '+(*)c'));
  });

  it('should allow limited nested repeated extglobs when configured', () => {
    assert.strictEqual(
      makeRe('+(+(a))', { maxExtglobRecursion: 1 }).source,
      '^(?:(?=.)(?:(?:a)+)+)$'
    );
    assert.strictEqual(
      makeRe('*(+(a))', { maxExtglobRecursion: 1 }).source,
      '^(?:(?=.)(?:(?:a)+)*)$'
    );

    assert(isMatch('aaa', '+(+(a))', { maxExtglobRecursion: 1 }));
    assert(isMatch('aaa', '*(+(a))', { maxExtglobRecursion: 1 }));
  });

  it('should still block ambiguous repeated alternation when recursion is allowed', () => {
    assert.strictEqual(
      makeRe('+(a|aa)', { maxExtglobRecursion: 1 }).source,
      '^(?:\\+\\(a\\|aa\\))$'
    );
    assert.strictEqual(
      makeRe('+(*|?)', { maxExtglobRecursion: 1 }).source,
      '^(?:\\+\\(\\*\\|\\?\\))$'
    );
  });

  it('should rewrite risky repeated extglobs embedded in larger patterns', () => {
    assert.strictEqual(
      makeRe('foo/+(a|aa)/bar').source,
      '^(?:foo\\/\\+\\(a\\|aa\\)\\/bar)$'
    );
    assert.strictEqual(
      makeRe('x+(a|aa)y').source,
      '^(?:x\\+\\(a\\|aa\\)y)$'
    );

    assert(isMatch('foo/+(a|aa)/bar', 'foo/+(a|aa)/bar'));
    assert(!isMatch('foo/aa/bar', 'foo/+(a|aa)/bar'));
    assert(isMatch('x+(a|aa)y', 'x+(a|aa)y'));
    assert(!isMatch('xaay', 'x+(a|aa)y'));
  });

  it('should rewrite star-only repeated extglobs embedded in larger patterns', () => {
    assert.strictEqual(
      makeRe('pre*(*(f)*(o))post').source,
      '^(?:pre[fo]*post)$'
    );

    assert(isMatch('prefoopost', 'pre*(*(f)*(o))post'));
  });

  it('should rewrite star-only repeated extglobs', () => {
    assert.strictEqual(
      makeRe('*(*(f))').source,
      '^(?:(?=.)f*)$'
    );

    assert(isMatch('fff', '*(*(f))'));
  });

  it('should rewrite multi-branch star-only repeated extglobs without dropping branches', () => {
    // Regression: the risky-extglob rewrite previously emitted only the first
    // branch, so `+(*(a)|*(b))` collapsed to `a*` and silently stopped matching
    // any string containing `b`. The safe rewrite must preserve every branch.
    assert.strictEqual(
      makeRe('+(*(a)|*(b))').source,
      '^(?:(?=.)[ab]*)$'
    );
    assert.strictEqual(
      makeRe('*(*(a)|c)').source,
      '^(?:(?=.)[ac]*)$'
    );

    for (const str of ['a', 'b', 'ab', 'ba', 'aabb']) {
      assert(isMatch(str, '+(*(a)|*(b))'), `expected to match ${str}`);
    }
    assert(!isMatch('c', '+(*(a)|*(b))'));

    for (const str of ['c', 'a', 'aca', 'cac']) {
      assert(isMatch(str, '*(*(a)|c)'), `expected to match ${str}`);
    }
    assert(!isMatch('d', '*(*(a)|c)'));
  });

  it('should preserve capture behavior for rewritten repeated extglobs', () => {
    const embedded = makeRe('foo/+(a|aa)/bar', { capture: true });
    assert.strictEqual(embedded.source, '^(?:foo\\/\\+\\(a\\|aa\\)\\/bar)$');
    assert.deepStrictEqual(
      Array.from(embedded.exec('foo/+(a|aa)/bar')),
      ['foo/+(a|aa)/bar']
    );

    const simplified = makeRe('*(*(f)*(o))', { capture: true });
    assert.strictEqual(simplified.source, '^(?:(?=.)([fo]*))$');
    assert.deepStrictEqual(
      Array.from(simplified.exec('fffooo')),
      ['fffooo', 'fffooo']
    );
  });

  it('should only rewrite the risky repeated extglob when adjacent extglobs are present', () => {
    assert.strictEqual(
      makeRe('+(a|aa)@(x)').source,
      '^(?:\\+\\(a\\|aa\\)(x))$'
    );

    assert(isMatch('+(a|aa)x', '+(a|aa)@(x)'));
    assert(!isMatch('aaax', '+(a|aa)@(x)'));
  });

  describe('repeated extglobs with a star in a branch', () => {
    // A `*` inside `+(...)` or `*(...)` (or a negation extglob, which ends in
    // a star) nests an unbounded quantifier inside the repeat, even when the
    // extglob has a single branch: `+(*a)` used to compile to `(?:[^/]*?a)+`,
    // which backtracks exponentially on input like `aaa...a!`.
    const output = (pattern, options) => parse(pattern, options).output;

    it('should not repeat a single branch that contains a star', () => {
      assert.strictEqual(output('+(*)'), '(?=.)(?:[^/]*?)');
      assert.strictEqual(output('*(*)'), '(?=.)(?:[^/]*?)?');
      assert.strictEqual(output('+(*a)'), '(?=.)(?:[^/]*?a)');
      assert.strictEqual(output('*(*a)'), '(?=.)(?:[^/]*?a)?');
      assert.strictEqual(output('+(a*)'), '(?=.)(?:a[^/]*?)');
      assert.strictEqual(output('+(*)c'), '(?=.)(?:[^/]*?)c');
      assert.strictEqual(output('x+(*a)y'), 'x(?:[^/]*?a)y');
      assert.strictEqual(output('+(!(b))x'), '(?=.)(?:(?:(?!(?:b))[^/]*?))x');
    });

    it('should not repeat the star branches of a multi-branch extglob', () => {
      assert.strictEqual(output('+(*a|b)'), '(?=.)(?:(?:b)*(?:[^/]*?a)(?:b)*|(?:b)+)');
      assert.strictEqual(output('*(a*|b)'), '(?=.)(?:(?:b)*(?:(?:a[^/]*?)(?:b)*)?)');
      assert.strictEqual(output('+(*.js|*.ts)'), '(?=.)(?:[^/]*?\\.js|[^/]*?\\.ts)');
    });

    it('should literalize a repeated star that cannot be rewritten safely', () => {
      assert.strictEqual(output('+(@(*a))'), '\\+\\(@\\(\\*a\\)\\)');
      assert.strictEqual(output('*(@(*a|b))'), '\\*\\(@\\(\\*a\\|b\\)\\)');
      assert.strictEqual(output('+(a*|*b)'), '\\+\\(a\\*\\|\\*b\\)');
      assert.strictEqual(output('+(*/*)'), '\\+\\(\\*/\\*\\)');
    });

    it('should preserve the meaning of repeated extglobs that contain a star', () => {
      assert(isMatch('abc', '+(*)'));
      assert(isMatch('abc', '*(*)'));
      assert(isMatch('abc', '+(*)c'));
      assert(!isMatch('abc', '+(*)x'));
      assert(isMatch('aba', '+(*a)'));
      assert(!isMatch('ab', '+(*a)'));
      assert(isMatch('xa', '*(*a)'));
      assert(isMatch('ab', '+(a*)'));
      assert(!isMatch('ba', '+(a*)'));
      assert(isMatch('xay', 'x+(*a)y'));
      assert(isMatch('xaay', 'x+(*a)y'));
      assert(!isMatch('xy', 'x+(*a)y'));
      assert(isMatch('xy', 'x*(*a)y'));
      assert(!isMatch('x/ay', 'x+(*a)y'));

      assert(isMatch('ab', '+(*a|b)'));
      assert(isMatch('bab', '+(*a|b)'));
      assert(isMatch('xab', '+(*a|b)'));
      assert(isMatch('bb', '+(*a|b)'));
      assert(!isMatch('ax', '+(*a|b)'));
      assert(isMatch('ax', '*(a*|b)'));
      assert(isMatch('bax', '*(a*|b)'));
      assert(isMatch('bb', '*(a*|b)'));
      assert(!isMatch('xa', '*(a*|b)'));
      assert(isMatch('a.js', '+(*.js|*.ts)'));
      assert(isMatch('a.jsb.ts', '+(*.js|*.ts)'));
      assert(!isMatch('a.ts.x', '+(*.js|*.ts)'));

      assert(isMatch('fff', '+(!(f))'));
      assert(!isMatch('f', '+(!(f))'));
      assert(isMatch('ax', '+(!(b))x'));
      assert(!isMatch('bx', '+(!(b))x'));

      assert(isMatch('a/b/', '+(*/)'));
      assert(isMatch('a/b/c', '+(*/)c'));
      assert.strictEqual(output('+(*/)'), '(?=.)(?:[^/]*?\\/)+');
    });

    it('should not backtrack catastrophically on repeated extglobs that contain a star', () => {
      const cases = [
        ['+(*)', 'a'.repeat(64) + '/'],
        ['*(*)', 'a'.repeat(64) + '/'],
        ['+(*)x', 'a'.repeat(64)],
        ['+(*a)', 'a'.repeat(64) + '!'],
        ['*(*a)', 'a'.repeat(64) + '!'],
        ['+(a*)', 'a'.repeat(64) + '/'],
        ['+(*?a)', 'a'.repeat(64) + '!'],
        ['+(**)x', 'a'.repeat(64)],
        ['x+(*a)y', 'x' + 'a'.repeat(64) + '!y'],
        ['+(!(b))x', 'a'.repeat(64)],
        ['+(*a|b)', 'a'.repeat(64) + '!'],
        ['*(a*|b)', 'a'.repeat(64) + '/'],
        ['+(*.js|*.ts)', 'a.js'.repeat(32) + '!'],
        ['+(@(*a))', 'a'.repeat(64) + '!'],
        ['+(*/*)x', 'a/'.repeat(32)]
      ];

      for (const [pattern, input] of cases) {
        const start = Date.now();
        assert(!isMatch(input, pattern), `${pattern} should not match`);
        assert(Date.now() - start < 1000, `${pattern} backtracked`);
      }
    });
  });

  it('should disable the safeguard when maxExtglobRecursion is false', () => {
    assert(
      /\(\?:a\|aa\)\+/.test(
        makeRe('+(a|aa)', { maxExtglobRecursion: false }).source
      )
    );
    assert(
      /\(\?:\(\?:a\)\+\)\+/.test(
        makeRe('+(+(a))', { maxExtglobRecursion: false }).source
      )
    );
  });
});
