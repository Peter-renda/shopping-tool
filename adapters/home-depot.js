// Home Depot product page adapter.
//
// Home Depot has at least two distinct page templates (/p/ and /pep/),
// renders A/B-tested variants, and re-skins frequently. Rather than chase
// one selector, this adapter tries several strategies in order of
// reliability and falls back to text-based discovery.
window.__bomAdapter = async ({ quantity, options }) => {
  const { waitFor, setInputValue, textEquals, sleep } = window.__bomHelpers;

  try {
    await dismissOverlays();

    // 1. Options (color/size/etc) — match by visible label.
    for (const [name, value] of Object.entries(options)) {
      await pickOption(name, value);
      await sleep(400);
    }

    // 2. Locate the Add-to-Cart button first; quantity controls usually
    //    live next to it.
    const atc = await findAddToCartButton();

    // 3. Quantity — try input field, then +/- buttons, then repeat-ATC.
    const { strategy } = await setQuantity(atc, quantity);

    // 4. Click ATC. For the repeat-atc strategy, click `quantity` times
    //    with a settle delay between clicks so the buybox can re-arm.
    const clicks = strategy === "repeat-atc" ? quantity : 1;
    for (let i = 0; i < clicks; i++) {
      atc.click();
      if (i < clicks - 1) await sleep(700);
    }

    // 5. Confirmation.
    await waitFor(
      '[data-testid*="cart" i][data-testid*="confirm" i], [class*="addedToCart" i], [aria-label*="Added to cart" i], [aria-live][role="status"]',
      { timeoutMs: 10_000 }
    ).catch(() => {});

    return { ok: true, strategy };
  } catch (err) {
    return { ok: false, message: err.message };
  }

  async function dismissOverlays() {
    // Store/zip code modal, cookie banner, promo popups — close anything
    // that intercepts clicks. Best-effort; no errors if they're absent.
    const closers = document.querySelectorAll(
      'button[aria-label*="close" i], button[data-testid*="close" i], button[class*="close" i]'
    );
    for (const c of closers) {
      try { c.click(); } catch {}
    }
  }

  async function pickOption(name, value) {
    const lcValue = value.toLowerCase();
    // Look for a labelled option group, then a button matching the value.
    const groups = [...document.querySelectorAll(
      '[data-testid*="option" i], [data-component*="option" i], [class*="ProductOption" i], [class*="variant" i]'
    )];
    const groupRegex = new RegExp(name, "i");
    const group = groups.find((g) => groupRegex.test(g.textContent || ""));
    const candidates = (group ?? document).querySelectorAll('button, [role="radio"], a[role="button"]');
    const choice = [...candidates].find((b) =>
      textEquals(b, value) ||
      (b.getAttribute("aria-label") || "").toLowerCase().includes(lcValue) ||
      (b.title || "").toLowerCase().includes(lcValue)
    );
    if (!choice) throw new Error(`Could not find option ${name}=${value}`);
    choice.click();
  }

  async function findAddToCartButton() {
    // Strategy 1: data-testid (current SPA convention).
    const direct = document.querySelector('button[data-testid*="add-to-cart" i]');
    if (direct && !direct.disabled) return direct;

    // Strategy 2: aria-label.
    const aria = [...document.querySelectorAll('button')].find(
      (b) => /add.*to.*cart/i.test(b.getAttribute("aria-label") || "") && !b.disabled
    );
    if (aria) return aria;

    // Strategy 3: visible text content.
    const text = [...document.querySelectorAll('button')].find(
      (b) => /add to cart/i.test(b.textContent || "") && !b.disabled
    );
    if (text) return text;

    // Strategy 4: poll once more after a short wait for late-rendering SPAs.
    return await waitFor('button', {
      timeoutMs: 8000,
      predicate: (b) => /add to cart/i.test(b.textContent || "") && !b.disabled,
    });
  }

  async function setQuantity(atc, quantity) {
    if (quantity === 1) return { strategy: "single" };

    // Search the whole document, not just the buybox — some HD templates
    // render the qty control outside the form element.
    const input = document.querySelector(
      'input[type="number"], input[name*="quantity" i], input[aria-label*="quantity" i], input[data-testid*="quantity" i], input[id*="quantity" i], input[class*="quantity" i]'
    );
    if (input) {
      setInputValue(input, quantity);
      return { strategy: "input" };
    }

    // <select> dropdown (some bulk-pack products).
    const select = document.querySelector(
      'select[name*="quantity" i], select[aria-label*="quantity" i], select[data-testid*="quantity" i]'
    );
    if (select) {
      const opt = [...select.options].find((o) => Number(o.value) === quantity || Number(o.textContent) === quantity);
      if (opt) {
        select.value = opt.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return { strategy: "select" };
      }
    }

    // Plus-button increments.
    const plus = document.querySelector(
      'button[aria-label*="increase" i], button[aria-label*="plus" i], button[data-testid*="quantity-plus" i], button[data-testid*="increment" i]'
    );
    if (plus) {
      for (let i = 1; i < quantity; i++) {
        plus.click();
        await sleep(80);
      }
      return { strategy: "stepper" };
    }

    // Last-resort fallback: click ATC `quantity` times. The first click
    // happens in the caller, so we mark this strategy and the caller
    // handles the extra clicks after each one settles.
    return { strategy: "repeat-atc" };
  }
};
