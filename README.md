# Ballot Match

A nonpartisan voter guide you install on a phone or tablet. Voters enter their ZIP code, pick the races on their ballot, answer 12 or 24 statements on the most divisive issues, and see which candidate in each race matches them best, and why.

It's a **progressive web app (PWA)**: a website that installs to the home screen and runs full-screen like a native app. It has no build step, so you can host it for free on GitHub Pages.

---

## 1. Put it on GitHub Pages (about 10 minutes)

1. On GitHub, click **+ → New repository**. Name it `ballot-match`, make it **Public** (free Pages hosting needs a public repo on the free plan), and click **Create repository**.
2. On the new repo page, click **uploading an existing file**.
3. Unzip the file, select **all the files** (there are no subfolders), and drag them into the upload area.
4. Click **Commit changes**.
5. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
6. After a minute or two, your app is live at **`https://YOUR-USERNAME.github.io/ballot-match/`**.

### Install it on your devices

- **iPhone / iPad:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in Chrome and tap **Install** in the app's header, or use the menu → **Install app**.

---

## 2. Turn on live ballots (optional, free)

Without an API key, the app runs on a **demo ballot of fictional candidates**. To load the real races and candidates for any U.S. address:

1. Go to <https://console.cloud.google.com/> and create a project (for example, "Ballot Match").
2. Open **APIs & Services → Library**, search for **Google Civic Information API**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Click the new key to **restrict** it. This matters, because the key is visible in the app's code:
   - **Application restrictions:** *Websites*. Add `https://YOUR-USERNAME.github.io/*`
   - **API restrictions:** *Restrict key* → choose **Google Civic Information API**.
   - Click **Save**.
5. In your GitHub repo, open `config.js`, click the pencil icon, paste the key between the quotes on the `CIVIC_API_KEY` line, and commit.
6. Open `sw.js` and change `const VERSION = 'bm-v1';` to `'bm-v2'` so installed copies pick up the change. Do this every time you edit app files.

**What live mode does:** for every lookup, the app asks Google's Civic Information API for the voter's contests and candidates, using data from election officials. Ballot data usually appears a few weeks before an election. A street address gives the most exact ballot, because ZIP codes can cross district lines.

**What it doesn't do yet:** score real candidates' stances. Real candidates show up with their party, website, photo (when available) and a Ballotpedia link, marked **"Not rated"**, until you add stance records (see section 3).

---

## 3. Add candidate stances

Matching uses `stances.json`. Each candidate gets one entry, keyed by their name in lower case with spaces and punctuation turned into hyphens:

```json
"jane-q-public": {
  "name": "Jane Q. Public",
  "positions": [2, -2, 1, 0, null, ...],
  "sources": [
    { "label": "Campaign website — Issues", "url": "https://example.com/issues" },
    { "label": "Vote Smart — Key votes", "url": "https://votesmart.org/..." }
  ]
}
```

- `positions` has **24 values**, in the same order as `questions.json`. Each value runs from `-2` (strongly disagrees with the statement) to `2` (strongly agrees). Use `null` when there's no public stance, and never guess from party.
- The name has to match how the candidate appears on the ballot. The app looks it up with the same lower-case, hyphenated form.
- Add sources for every stance. They show up on the candidate's profile.

You can delete the 21 demo entries (marked `"demo": true`) once you're using live ballots.

---

## 4. What's in the folder

Every file sits in one folder, with no subfolders, so it uploads to GitHub in one drag.

| File | What it is |
|---|---|
| `index.html` | App shell |
| `app.css` | Mobile-first styles: phone, then tablet portrait (≥600 px), then tablet landscape and desktop (≥960 px, side-by-side results and profile) |
| `app.js` | Screens, routing, matching, live ballot lookup |
| `icons.js` | Ballot Match icon set |
| `config.js` | **Your settings** (API key) |
| `questions.json` | The 12 topics and 24 statements |
| `stances.json` | Candidate stance records |
| `demo-ballot.json` | The fictional demo ballot |
| `sw.js` | Service worker: works offline, installable |
| `manifest.webmanifest`, `*.png`, `favicon.svg` | Home-screen name, colors and icons |

**Test on your computer:** in the folder, run `python3 -m http.server 8000` and open <http://localhost:8000>. Opening `index.html` directly with a double-click won't work, because browsers block the data files.

---

## 5. Privacy

- Quiz answers are saved only in the browser on the voter's device, so they can pick up where they left off. Nothing is sent to a server.
- The ZIP code and address go only to Google's Civic Information API, to find the ballot. The app never caches them in the service worker.

## 6. Next steps

- **Stance pipeline:** a scheduled GitHub Action that pulls from Vote Smart, OpenFEC, candidate websites and news, has an AI model propose positions with citations, and opens a pull request for a person to review before anything goes live.
- **Ballotpedia data license**, for better local-race coverage.
- **Native app store versions** (Capacitor or Expo), if you want push reminders like "Early voting ends Friday."
