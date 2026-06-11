# 🛡️ SFCC Guard

**Production safety guard for Salesforce Commerce Cloud.**

Catches critical issues before they reach production — installed in 2 minutes, runs on every PR automatically.

---

## Why SFCC Guard?

Every SFCC developer knows the feeling: a PR looks fine, it passes code review, gets merged — and then production breaks at 2am because of something a generic linter would never catch.

SFCC Guard knows SFCC. It catches the patterns that **only break in production**, specific to the Commerce Cloud platform.

---

## Rules

| Rule | Severity | Description |
|------|----------|-------------|
| **R3** | 🔴 Error | `Transaction.wrap()` missing on Order/Basket writes |
| **R4** | 🔴 Error | Hook declared in `hooks.json` but implementation file not found |
| **R5** | 🔴 Error | `require()` using relative paths (`../../`) instead of SFCC cartridge paths |
| **R9** | 🔴 Error / 🟡 Warning | Promotion XML with discount at or above threshold (default: 99%) |

---

## Usage

Add to your repository at `.github/workflows/sfcc-guard.yml`:

```yaml
name: SFCC Guard

on:
  pull_request:
    branches: [main, master, develop, staging]
    paths:
      - 'cartridges/**'
      - 'data_impex/**'

jobs:
  sfcc-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: sfcc-guard/action@v1
        with:
          cartridges-path: './cartridges'
          metadata-path: './data_impex'
          discount-threshold: '99'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

That's it. SFCC Guard will automatically comment on every PR with results.

---

## Example PR Comment

```
## SFCC Guard 🔴 FAILED

**2 error(s)** must be fixed before merging.

### Transaction.wrap required for order writes

🔴 [R3] Write to `.custom` attribute outside `Transaction.wrap()`
> 📁 `cartridges/org_storefront/cartridge/scripts/helpers/orderHelpers.js` (line 142)
> `order.custom.externalId = payload.id;`
> 💡 Wrap this assignment inside Transaction.wrap(function() { ... })

### Hook implementation missing

🔴 [R4] Hook `app.payment.processor.newpayment` declared but implementation not found
> 📁 `cartridges/int_newpayment/hooks.json`
> Expected at: ./cartridge/scripts/hooks/payment/processor/newpayment
> 💡 Create the hook implementation file or remove the hook declaration
```

---

## Configuration

| Input | Default | Description |
|-------|---------|-------------|
| `cartridges-path` | `./cartridges` | Path to your cartridges folder |
| `metadata-path` | `./data_impex` | Path to metadata/data_impex folder |
| `discount-threshold` | `99` | Max allowed discount % in promotion XMLs |
| `fail-on-warning` | `false` | Fail the PR on warnings too |
| `github-token` | `${{ github.token }}` | Token for PR comments |

---

## Suppressing a violation

Add `// sfcc-guard-ignore` on the line to suppress:

```js
order.custom.legacyField = value; // sfcc-guard-ignore
```

---

## Roadmap

- [ ] R6 — CSRF protection missing on endpoints
- [ ] R7 — Campaign without end date (XML)
- [ ] R8 — Promotion XML with impossible conditions
- [ ] R1 — Service ID cross-reference (for repos with services.xml)
- [ ] R2 — Custom attribute cross-reference (for repos with objecttype-extensions.xml)
- [ ] Inline annotations support
- [ ] Custom rules via config file

---

## License

MIT
