# DP Construction Group — Payroll & HR System

A free, self-hosted payroll pack: employee register, timesheets, leave
register, payroll runs, branded payslips (with QR code), and payroll
summaries — running entirely from a static webpage on GitHub Pages, with
Firebase as the database. No monthly software fee.

**Files in this folder:**
- `index.html` — the app itself (open this in a browser once deployed)
- `app.js` — all the app logic
- `firebase-config.js` — **you edit this** with your own Firebase project keys
- `firestore.rules` — security rules to paste into Firebase
- `README.md` — this file

---

## Part 1 — Create your Firebase project (10 minutes, free)

1. Go to **https://console.firebase.google.com** and sign in with a Google account.
2. Click **Add project**. Name it something like `dpc-payroll`. You can
   disable Google Analytics (not needed) and click **Create project**.
3. In the left sidebar, click **Build → Firestore Database** → **Create
   database**. Choose a location close to South Africa (e.g.
   `europe-west1` or `me-west1`), and start in **Production mode**.
4. In the left sidebar, click **Build → Authentication** → **Get started**.
   Under **Sign-in method**, enable **Email/Password**.
5. Still in Authentication, go to the **Users** tab → **Add user**. Enter
   your own email and a password — this is what you'll use to log in to
   the payroll system. (Add one user per person who should have access,
   e.g. you and your bookkeeper.)
6. In the left sidebar, click the **gear icon → Project settings**. Under
   **Your apps**, click the **`</>`** (web) icon to register a web app.
   Give it any nickname (e.g. "Payroll website") and click **Register app**.
   Firebase will show you a code block that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "dpc-payroll.firebaseapp.com",
     projectId: "dpc-payroll",
     storageBucket: "dpc-payroll.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

   Copy those six values.

7. Open `firebase-config.js` in this folder and paste your six values in,
   replacing the placeholder text. Save the file.

8. Back in the Firebase Console, go to **Firestore Database → Rules** tab,
   delete everything there, paste in the contents of `firestore.rules`
   from this folder, and click **Publish**. (This locks the database so
   only your logged-in users can read or write data — no one else can see
   your payroll.)

That's it for Firebase. Your data (employees, timesheets, payslips) will
now be stored securely in this project, and you can view it any time
under **Firestore Database → Data** in the console.

---

## Part 2 — Host it on GitHub Pages (5 minutes, free)

1. Create a new **GitHub repository** (e.g. `dpc-payroll`). It can be
   Private or Public — Private is fine, since the app itself requires
   login regardless.
2. Upload all the files in this folder (`index.html`, `app.js`,
   `firebase-config.js` with your real keys, `README.md`) to the repo —
   either by dragging them into the GitHub web UI ("Add file → Upload
   files") or via `git push`.
3. In the repo, go to **Settings → Pages**. Under **Source**, choose
   **Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
4. After a minute, GitHub will show you a URL like
   `https://yourusername.github.io/dpc-payroll/`. That's your live
   payroll system — bookmark it.
5. Log in with the email/password you created in Firebase Authentication
   (step 5 above).

**Note on privacy:** even though GitHub Pages URLs are technically public
if someone knows the exact link, no one can see or touch your payroll
data without logging in with an account you created — the Firestore
rules block everything else. If you'd rather the *files* also aren't
publicly reachable, keep the GitHub repo Private and use GitHub's Pages
option that requires a paid GitHub plan for private-repo Pages, or host
it instead on Firebase Hosting (free, and naturally pairs with the
Firebase project you already made — ask me if you'd like those steps
too).

---

## Part 3 — Using the system

- **Company Settings** — enter DP Construction Group's details and
  upload a logo (shown on every payslip).
- **Employees** — add each worker: name, ID number, position, pay type
  (hourly / daily / fixed monthly), rate, banking details, and starting
  leave balances.
- **Timesheets** — each pay period, capture hours/days worked, overtime
  (paid at 1.5×), Sunday/public holiday hours (paid at 2×), allowances,
  bonuses, and any other deductions per employee.
- **Leave Register** — capture approved leave; balances are deducted
  automatically.
- **Run Payroll** — pick the pay period, review the calculated PAYE, UIF
  and net pay for each employee, then generate payslips.
- **Payslips** — view, print, or save any payslip as a PDF (each has a
  unique payslip number and QR code).
- **Payroll Summary** — a totals table per period, exportable to CSV for
  your accounting records or SARS/EMP201 filing.

### About the tax calculations

PAYE is estimated using SARS's **2026/2027 tax year** brackets and
primary/secondary/tertiary rebates (1 March 2026 – 28 February 2027),
and UIF is calculated at 1% of remuneration capped at R177.12/month. This
is a simplified, good-faith monthly estimate suitable for day-to-day
payslip generation — it doesn't yet account for things like medical aid
tax credits or retirement fund contributions. Before submitting EMP201/
EMP501 returns to SARS, reconcile the figures against SARS's official
tax deduction tables, or have your accountant/tax practitioner check
them.

---

## Ideas for later (just ask if you want any of these added)

- Overtime at different rates for public holidays vs Sundays
- Medical aid and retirement fund deduction fields (with tax credit)
- Multiple company branches/sites
- Emailing payslips directly to employees
- Firebase Hosting instead of GitHub Pages (keeps everything in one place)
