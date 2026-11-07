# Maranatha Girls Academy – Online Prefect Election System

Static web app (HTML5 / CSS3 / vanilla JavaScript) hosted on **GitHub Pages**, using **Firebase Spark (free)** for Authentication and Firestore. No Cloud Functions, no Firebase Storage, no paid APIs, no domain, no credit card.

```
index.html     home page (branding, election status, instructions, logins)
student.html   student login + voting portal
admin.html     administrator dashboard
css/style.css
js/            firebase-config.js (your Firebase settings), firebase.js, constants.js, util.js,
               tally.js (counting), reports.js (PDF/Excel), home.js, student.js, admin.js
firestore.rules  security rules (you paste these into the Firebase console)
tests/         counting unit tests (npm test, optional)
```

## 0. Read this first – what is and is not guaranteed

Tested here: the counting logic (unit tests, `npm test`), JavaScript syntax, and the name/class matching used at login. **Not tested here:** the Firebase connection, the Firestore rules and the browser screens. This build environment has no access to Firebase or its emulator, so those parts have not been run. Section 11 (test election) is how you test them, and you must do it before the real vote. If something fails, send me the error text.

**This system is not tamper-proof and the README does not claim it is.** What it does and does not enforce:

| Requirement | Status |
|---|---|
| Unique voter accounts, Firebase Auth | Enforced (one account per student, created by the administrator) |
| One vote per position | Enforced by Firestore rules (a ballot is accepted only in the same batch that sets the voter's "voted" flags, and flags can never be removed or changed). Not enforced by JavaScript or localStorage. |
| No vote changes after submission | Enforced by rules (ballots are immutable; voter flags are write-once) |
| Voting only while open | Enforced by rules (they read the election status) |
| Students cannot see results while voting | Enforced by rules (ballots readable by admins only; published results readable by students only after close, and only if you tick "publish") |
| Voter identity separated from choices | Ballots contain **no voter id**; the voter record only holds "has voted" flags. The dashboard never shows who voted for whom. |
| Admin cannot see individual choices in the app | True for the dashboard. See limit 2 below. |
| Vote validation | Rules check ballot structure, allowed positions and maximum selections. Whether a choice id belongs to a real candidate is checked **at count time**, and invalid choices are excluded and reported. |

**Known limits (not possible to close without a paid backend):**

1. **Double ballot in one batch.** A technically skilled student using browser developer tools could put two ballots into one batch. Firestore rules cannot count documents in a batch while keeping ballots anonymous. The system **detects** it: the Results tab warns when ballots counted exceed voters marked as voted. It does not prevent it.
2. **Whoever owns the Firebase project (console access) is fully trusted.** They can read ballots and voter records directly, and the console shows each document's creation time, which could be used to guess who voted how. Keep console access to one or two trusted staff, and give other officials admin-dashboard accounts only.
3. **The student login is not secret.** A student logs in with her short name (e.g. `E.SAMUEL`) and her class (e.g. `FORM 2`). Anyone who knows a student's name and class can work this out, from any device, because the site is public. This is acceptable **only because voting is supervised** (computer lab, teacher present). Do not announce the site address for use outside supervised sessions. See section 8.
4. **Counting runs in the administrator's browser**, reading the real ballots from Firestore. On the free plan there is no server to do it. "Automatic finalisation" happens when the admin presses *Close*. The published results snapshot is written by that browser, so the Results tab always recounts from the ballots and tells you whether the snapshot still matches.
5. **No scheduled opening/closing.** Open and close are manual buttons.
6. **Transport and device security** are Firebase's/the browser's. There is no end-to-end verifiable voting.

## 1. Free-plan limits and this app's usage

Firebase's pricing page (https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) states Spark includes **50,000 Firestore reads and 20,000 writes per day**, and that exceeding a Spark quota shuts that product off for the rest of the month. Check the current numbers on that page before the election.

Approximate use of this app:

* Per student: about 25–30 reads at voting (login + loading the candidate documents, twice because the portal reloads after submitting) and **3 writes** in total (account record, ballot, voted flags).
* 600 students ≈ 16,000 reads and 1,800 writes. A school of roughly 1,500 students would still fit under 50,000 reads in one day. Register students on a **different day** from voting so the write quota is not shared.
* The admin Results tab reads every ballot (about one per student) each time it loads or recounts, and the Voters tab reads every voter. Avoid pressing *Recount* hundreds of times.
* Candidate photos are stored inside Firestore as small compressed JPEGs (about 10–20 KB). **Firebase Storage is not used**, so there is no billing prerequisite.
* Creating many accounts quickly can trigger Firebase's anti-abuse throttle (`auth/too-many-requests`). The import then stops and reports it. Wait ten minutes and import the same list again: students who were already registered are skipped.

## 2. Create the Firebase project (free)

1. Go to https://console.firebase.google.com and sign in with a Google account.
2. **Add project** → name it (e.g. `prefect-election`) → turn **Google Analytics off** → Create. Stay on the **Spark** plan; never click *Upgrade*.

## 3. Connect the app to Firebase

1. Project overview → **Web (`</>`)** → register an app (do **not** tick Firebase Hosting) → copy the `firebaseConfig` values.
2. Open `js/firebase-config.js` and put in the four values (`apiKey`, `authDomain`, `projectId`, `appId`). These values are public by design; the rules are what protect the data.

## 4. Authentication setup

1. Build → **Authentication** → Get started → **Sign-in method** → enable **Email/Password** (leave "Email link" off). Student logins depend on this.
2. **Settings → Authorized domains** → add `YOUR-USERNAME.github.io`.
3. **Users → Add user**: create your own administrator login (email + strong password). Copy its **User UID**.
4. Do the same for any other election officials.

## 5. Firestore database, structure and rules

1. Build → **Firestore Database** → Create database → pick a location near you (it cannot be changed later) → **Production mode**.
2. **Rules** tab → delete everything → paste the entire contents of `firestore.rules` → **Publish**.
3. Create the first administrator record by hand (only the console can do this): **Data** tab → Start collection `admins` → Document ID = the **UID** from step 4.3 → add a field `email` (string). Repeat for each officer.

There are **14 positions**: head, vice, health, sanitation, dining, tuckshop, entertainment, library, english, dormitory, chapel, maintenance, timekeeper, studycircles. (`firestore.rules` also allows an unused `sports` id; this is harmless.) The list lives in `js/constants.js` and is repeated in `firestore.rules`; if you ever add a position, change both.

Structure:

| Path | Contents |
|---|---|
| `admins/{uid}` | `email` – marks a user as administrator (console only) |
| `settings/election` | `status` (`setup`/`open`/`closed`), `title`, `publishResults`, `positions.dining.{seats,maxSelect}` |
| `candidates/{positionId}` | `items: [{id, name, manifesto, photo}]` – one document per position |
| `voters/{uid}` | `name, studentId, form, voterCode, active, voted:{positionId:true}` – identity and participation only |
| `ballots/{autoId}` | `votes:{positionId:[candidateId,…]}` – **no voter identity** |
| `results/final` | snapshot of the counts, written when the election closes |
| `audit/{autoId}` | append-only log of administrator actions |

## 6. GitHub repository and GitHub Pages

1. Create a free account at https://github.com, then **New repository** → name e.g. `prefect-election` → **Public** (free Pages needs public on a free account) → Create.
2. **Add file → Upload files** → drag in **everything in this folder** (including the `css`, `js`, `tests` folders, `.nojekyll`, `firestore.rules`) → Commit.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
4. After a minute the site is at `https://YOUR-USERNAME.github.io/prefect-election/`. Make sure that domain is in Authentication → Authorized domains (step 4.2).
5. The repository is public, so it contains your Firebase config (which is meant to be public) and **no passwords or student data**. Never upload the student list, marksheets or the voter-code CSV to it.

## 7. Adding real students and candidates

Open `…/admin.html` and log in.

1. **Overview → Initialise election** (first time only).
2. **Voters tab**
   * One student: enter name, student ID, form → register.
   * List: choose your **Excel marksheet** (`.xlsx` / `.xls`) or a `.csv`. The app looks for a column headed *Name* (and optionally *Admission No.* and *Class / Form*) and reads every sheet in the file, so one sheet per class works. Or paste lines of `Full name, Student ID, Form`. Students already registered are skipped.
   * **How each student's login is made.** The **Voter Code** is the short name: first initial, a dot, and the surname, e.g. `E.SAMUEL`. If the marksheet writes names as `SAMUEL Edward` (surname in capitals) or `Edward Samuel`, both give `E.SAMUEL`. The **password is the class**: `FORM 2`, `Form 2`, `form2` and `F2` all work. A class with a stream (e.g. `FORM 2A`) must be typed with the stream.
   * **Duplicate codes.** If two students would get the same code, the second one gets a number (`E.SAMUEL2`). Check the Voters tab for any codes ending in a number and tell those students (the printed list shows each code).
   * After registering, a panel lists the new Voter Codes. **Download the CSV** and/or **Print voting slips**, then hide the panel. The codes also stay visible in the Voters tab.
   * Lost or wrong code: *New credentials* (the old login is disabled; positions already voted stay locked). *Deactivate* removes a student's access.
3. **Candidates tab** (only while the election is in Setup): choose a position → name, manifesto, photo (auto-resized) → *Add*. Edit and Remove are on the right. Each position should have candidates before opening.
4. **Election tab**: set Dining Prefects *positions available* and *maximum choices per voter*; decide whether students may see official results after close; *Save settings*.
5. **Open the election.** From now on candidates and Dining settings are locked.

## 8. How students vote (supervised)

Voting takes place in the lab with a teacher present. Students go to `…/student.html`, type their **name** (e.g. `E.SAMUEL`) and **class** (e.g. `FORM 2`), then press **Vote** on one candidate per position (or **Abstain**; Dining allows up to the configured number). They watch the progress bar, press **Review & Submit**, tick the confirmation and **Submit**. They see a confirmation and cannot vote again.

The supervisor's job matters, because the login is not secret (limit 3): each student votes only in her own name, one student per computer, and logs out when done.

## 9. Monitoring and results

* **Overview**: registered voters, who has voted, turnout, participation per position (never choices).
* **Results tab**: recounts all ballots from Firestore – votes, percentage of valid votes, valid/abstain/invalid, leader, ties, charts and tables. While open it is labelled PROVISIONAL (admins only); after closing it is FINAL.
* **Close the election** (Election tab, type `CLOSE`): voting stops, the count is finalised and `results/final` is written automatically. Ties are listed, never silently resolved.

## 10. Exporting official results

Results tab → **Download PDF** / **Download Excel** (Summary, Results and Position-totals sheets) or **Print results**. Do it after closing so the file is labelled FINAL. Keep a copy of both files and of the Audit log (Audit tab) with the school records.

## 11. Conducting a test election (do this before the real one)

1. Set up the system exactly as above. Register 3–4 **test** students (names like `TEST ONE`, ID `TEST1`, form `FORM 2`; look at the Voters tab to see the Voter Code each one gets), add 2–3 fake candidates per position, set Dining to 2 seats / 2 choices.
2. **Open** the election. On a phone, log in as the first test student using only the name and class, and vote. Try pressing back/refresh and voting again (it must be refused / show as locked). Log in as the second and vote differently. Leave the third unvoted. Also try a **wrong class** and a **misspelled name**: both must fail with a clear message.
3. Admin → Results: confirm counts match what you voted, percentages add up, turnout is 2/3 (or similar), and a deliberate tie shows as TIE.
4. Confirm a student account cannot open `admin.html` and cannot see results.
5. **Close**, download the PDF and Excel and check them. Student login must now say voting is closed.
6. **Election tab → Reset election data** (type `RESET`). Then **deactivate** every test student and remove the test candidates.
7. Register the real students, add the real candidates, open.

If any step behaves differently from this list, do not run the real election until it is understood.

## 12. Troubleshooting

* *"Login failed. Check that your name is spelled as on the register…"* → the name or class is wrong, or the student is not registered. Look her up in the Voters tab and read her **Voter Code** and **Form**. Also check Email/Password is enabled (section 4.1).
* *Student has a numbered code (e.g. `E.SAMUEL2`)* → two students shared a short name; she must type the numbered code.
* *"This account is not registered as an active voter"* → she was deactivated or her voter record is missing; use *New credentials* or register her again.
* *"Missing or insufficient permissions"* → rules not published, `admins/{uid}` missing, or the action is not allowed in the current status (e.g. candidates after opening).
* *Blank page / console error about modules* → open the site through the GitHub Pages URL (or a local web server), not by double-clicking the HTML file.
* *Login says "not an authorised administrator"* → the `admins` document ID must equal the user's UID exactly.
* *PDF/Excel buttons fail* → the free CDN scripts (jsDelivr) did not load; check the internet connection.
