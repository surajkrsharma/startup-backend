# Email templates

`renderTemplate()` in `src/services/template.service.ts` resolves a key in this
order:

1. **`EmailTemplate` DB row** — the real source of truth. `npm run seed`
   inserts every key the API uses.
2. **A file in this directory** — the fallback for a key with no DB row.
3. **Empty string**, with a `[email] template not found` log line.

The files here exist so a deployment that has not been seeded still delivers a
readable OTP instead of a blank body. Once the DB is seeded they are not used.

A file must be named after the key it serves, e.g. `reset_password.html`.
Available keys are in `EMAIL_TEMPLATE_KEY` in `src/constants/tracking.ts`.

The body is Handlebars, so `{{otp}}`, `{{purpose}}` and `{{appName}}` are
substituted from the caller's `templateData`.
