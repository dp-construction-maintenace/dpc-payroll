# DP Construction Group — Payroll & HR System

A free, self-hosted payroll pack: employee register, timesheets, payroll
runs, branded payslips (with QR code), and payroll summaries — running
entirely from a static webpage on GitHub Pages, with Firebase as the
database. No monthly software fee.

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
  (hourly / daily / fixed monthly), **pay frequency** (Fortnightly or
  Monthly), rate, and banking details.
  - Set **directors and casual/site staff** to **Fortnightly** — they're
    paid every two weeks for the days/hours they worked.
  - Set **salaried staff (e.g. the bookkeeper)** to **Monthly**.
- **Timesheets** — has two tabs, **Fortnightly Staff** and **Monthly
  Staff**. Pick the tab, then the period (a start date for a fortnight,
  or a calendar month), and capture hours/days, overtime (×1.5),
  Sunday/public holiday hours (×2), allowances, bonuses and any other
  deductions for each employee in that group.
- **Run Payroll** — same two tabs (Fortnightly/Monthly). Pick the period,
  review gross pay, other deductions and net pay for each employee in
  that group, then generate payslips. Run it twice a month for the
  fortnightly group and once a month for the monthly group.
- **Payslips** — same two tabs; view, print, or save any payslip as a
  PDF (each has a unique payslip number and QR code).
- **Payroll Summary** — same two tabs; a totals table per period,
  exportable to CSV for your accounting records.

### About the fortnight date picker

A "fortnight" here is any 14-day run you choose — pick the **start date**
of the pay cycle you're running (e.g. the 1st, or a Monday) and the
system automatically works out the 14-day period from there and labels
it clearly on-screen and on the payslip. There's no fixed calendar
alignment required, so it'll match whatever cycle DP Construction Group
actually pays on.

### What this system does — and doesn't — calculate

Net pay = gross pay (normal + overtime + Sunday/PH + allowances +
bonuses, minus any unpaid-leave deduction for monthly staff) minus
whatever you type into "Other Deductions" on the timesheet. **It does
not calculate PAYE, UIF, or any other statutory deduction**, and it does
not track leave or sick-leave balances — those were intentionally left
out for now. If you need PAYE/UIF or leave tracking added back in later,
just ask.

---

## Ideas for later (just ask if you want any of these added)

- PAYE and UIF calculations (SARS tax tables)
- Leave/sick day register with balances
- Overtime at different rates for public holidays vs Sundays
- Medical aid and retirement fund deduction fields
- Multiple company branches/sites
- Emailing payslips directly to employees
- Firebase Hosting instead of GitHub Pages (keeps everything in one place)
