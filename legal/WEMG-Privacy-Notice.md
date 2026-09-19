# WEMG — Privacy Notice

**Last updated: [DATE]**

This notice explains what personal data WEMG collects,
why, and what your rights are. It covers the desktop application only.

## Who is responsible

**Whiteley Events Ltd** ("we") is the data controller.

> Whiteley Events Ltd, [REGISTERED ADDRESS]
> [CONTACT EMAIL]
> [ICO REGISTRATION NUMBER, if registered]

## What we collect, and when

When you register the application, and each time it checks in with our
licence server, the following is sent to `whiteleyevents.co.uk`:

| Data | Source | Why |
| --- | --- | --- |
| Your name | You, at registration | To identify the licence holder |
| Your email address | You, at registration | To identify the licence holder and contact you about the software |
| Computer name | Your device's hostname | To distinguish installs belonging to the same person |
| Install identifier | Generated on first run (a random UUID) | To recognise this installation across launches |
| Application version | The application | Support and compatibility |
| IP address and timestamp | Your network connection, recorded by our server | Security, abuse prevention and server logs |

The application checks in when it starts. Each successful check-in records
the time it was last seen.

## What we do **not** collect

**We do not collect, transmit or store anything about what you download.**
No URLs, titles, video identifiers, file names, download history or media
content ever leave your computer. Downloading happens directly between your
computer and the source site; our servers are not involved and receive no
record of it.

We use no analytics, tracking, advertising or profiling of any kind.

## Lawful basis

- **Performance of a contract** (UK GDPR Article 6(1)(b)) — administering the
  licence that permits you to use the software.
- **Legitimate interests** (Article 6(1)(f)) — preventing unlicensed use,
  keeping our server secure, and contacting licence holders about defects,
  security issues or updates. We have considered your interests and consider
  this processing proportionate to that purpose.

## How long we keep it

Registration records are kept for as long as the installation remains in
use, and for **[RETENTION PERIOD, e.g. 24 months]** after the last check-in,
after which they are deleted. Server access logs are kept for
**[LOG RETENTION, e.g. 90 days]**.

## Who else sees it

Registration data is stored in our website's database, hosted by our web
host **[HOSTING PROVIDER]** in **[LOCATION]**. We do not sell your data,
and we do not share it with third parties except where we are required to by
law.

## Your rights

Under UK GDPR you have the right to access your data, have it corrected or
erased, restrict or object to how we use it, and receive a copy in a portable
form. To exercise any of these, contact **[CONTACT EMAIL]**.

If you use the application only on your own device and no longer wish us to
hold your registration, ask us and we will delete the record; the software
will then stop working 30 days after its last successful check-in.

You also have the right to complain to the Information Commissioner's Office
(<https://ico.org.uk>), though we would ask you to raise it with us first.

## Where your data is stored on your own computer

Your registration details and check-in state are also stored locally, in:

```
~/Library/Application Support/WEMG/licence-checkin.json
```

Deleting the application and that folder removes everything the application
holds about you locally. It does not delete our server-side record — ask us
for that.
