import { computeMenuPosition } from '../src/components/UnifiedDropdown.jsx';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};

// A phone-sized viewport.
const VW = 390;
const VH = 780;

const rect = (top, height = 42, left = 24, width = 342) => ({
  top, left, width, height, bottom: top + height, right: left + width
});

const onScreen = (p, vw = VW, vh = VH) =>
  p.top >= 0 && p.left >= 0 && p.top + p.maxHeight <= vh + 0.5 && p.left + p.width <= vw + 0.5;

console.log('\n--- The regression: sheet still springing up, trigger below the fold ---');
{
  // The bottom sheet animates from y:100%. Tapping a dropdown a few frames in
  // measured a trigger at y≈900 on a 780px screen. The old maths produced a
  // negative offset and parked the menu below the viewport permanently.
  const p = computeMenuPosition({ rect: rect(900), viewportW: VW, viewportH: VH, naturalHeight: 180 });
  check('menu stays inside the viewport', onScreen(p), JSON.stringify(p));
  check('top is not negative', p.top >= 0, `top=${p.top}`);
  check('has usable height', p.maxHeight >= 100, `maxHeight=${p.maxHeight}`);
}

console.log('\n--- Trigger completely above the viewport (scrolled past) ---');
{
  const p = computeMenuPosition({ rect: rect(-200), viewportW: VW, viewportH: VH, naturalHeight: 180 });
  check('still on screen', onScreen(p), JSON.stringify(p));
  check('top is not negative', p.top >= 0, `top=${p.top}`);
}

console.log('\n--- Trigger near the bottom: opens upwards, fully visible ---');
{
  const p = computeMenuPosition({ rect: rect(700), viewportW: VW, viewportH: VH, naturalHeight: 200 });
  check('opens upwards', p.openUpwards === true);
  check('sits above the trigger', p.top + p.maxHeight <= 700, `top=${p.top} h=${p.maxHeight}`);
  check('on screen', onScreen(p), JSON.stringify(p));
}

console.log('\n--- Trigger near the top: opens downwards ---');
{
  const p = computeMenuPosition({ rect: rect(80), viewportW: VW, viewportH: VH, naturalHeight: 200 });
  check('opens downwards', p.openUpwards === false);
  check('sits below the trigger', p.top >= 80 + 42, `top=${p.top}`);
  check('on screen', onScreen(p), JSON.stringify(p));
}

console.log('\n--- Tight squeeze: barely any room either way ---');
{
  const p = computeMenuPosition({ rect: rect(300, 42), viewportW: VW, viewportH: 420, naturalHeight: 400 });
  check('never overflows the bottom', p.top + p.maxHeight <= 420 + 0.5, JSON.stringify(p));
  check('never goes off the top', p.top >= 0, `top=${p.top}`);
}

console.log('\n--- Horizontal clamping ---');
{
  const wide = computeMenuPosition({ rect: rect(200, 42, 20, 600), viewportW: VW, viewportH: VH, naturalHeight: 180 });
  check('a too-wide trigger is clamped to the viewport', wide.left + wide.width <= VW, JSON.stringify(wide));

  const offRight = computeMenuPosition({ rect: rect(200, 42, 360, 200), viewportW: VW, viewportH: VH, naturalHeight: 180 });
  check('a trigger near the right edge is pulled back', offRight.left + offRight.width <= VW, JSON.stringify(offRight));

  const offLeft = computeMenuPosition({ rect: rect(200, 42, -50, 200), viewportW: VW, viewportH: VH, naturalHeight: 180 });
  check('a trigger off the left edge is pulled back', offLeft.left >= 0, JSON.stringify(offLeft));
}

console.log('\n--- A short menu is not stretched ---');
{
  const p = computeMenuPosition({ rect: rect(200), viewportW: VW, viewportH: VH, naturalHeight: 60 });
  check('height matches the content', p.maxHeight === 60, `maxHeight=${p.maxHeight}`);
}

console.log('\n--- Sweep: no trigger position anywhere puts it off-screen ---');
{
  let bad = 0;
  for (let top = -400; top <= 1200; top += 13) {
    for (const height of [180, 400]) {
      const p = computeMenuPosition({ rect: rect(top), viewportW: VW, viewportH: VH, naturalHeight: height });
      if (!onScreen(p)) { bad++; if (bad === 1) console.log('    first failure at top=' + top, JSON.stringify(p)); }
    }
  }
  check('every position in the sweep is visible', bad === 0, `${bad} off-screen results`);
}

console.log(failed === 0 ? '\nALL DROPDOWN CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
