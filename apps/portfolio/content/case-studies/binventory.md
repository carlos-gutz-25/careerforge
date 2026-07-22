---
title: A Phone-First Whole-Home Inventory System
description: A private, phone-first home-inventory application built around QR labels, an on-device AI catalog assistant, and a LAN-only secure origin, developed as a spec-driven personal project.
provenance: personal_ai_assisted
date: 2026-07-22
---

## Problem

I wanted to solve a real household problem: knowing what we own, where it is, and
what maintains it. Manuals get lost, warranties lapse unnoticed, and nobody
remembers which bin holds the spare cables. I did not want a spreadsheet or a
cloud service that would ask the household to create accounts and hand our
belongings to someone else's servers.

The design goal was a system I could use while standing in a closet with a phone
in one hand. Every bin, drawer, appliance, and standalone item gets a printed QR
sticker; scanning it opens that thing's page, showing its contents, photos,
manuals, appliance details, and maintenance history. The people who use it are my
own household, on our own network, so the product could make assumptions a public
SaaS never could.

This case study is an architecture and engineering-decisions write-up. The
repository is private and under active development, so it is not linked here, and
every example in this write-up is generalized: no real household data, addresses,
or photos appear.

## Constraints

The application is private and runs only on the home network, which shaped nearly
every decision.

* **No accounts.** Access is bounded by the trusted home Wi-Fi, so the app has no
  login. Anyone on the network can view and edit everything. That removed an
  entire authentication and authorization surface but meant I had to solve
  accountability a different way.
* **Local-first and private.** Nothing about the household leaves the house. Data
  lives in a local database on a single always-on machine, and the AI features
  run on that same machine rather than calling a cloud API.
* **Phone-first and offline-capable.** The primary device is a phone used away
  from a desk, sometimes in a garage or basement with weak signal, so the app had
  to install like a native app and keep working offline.
* **A secure origin without a public domain.** The in-app camera scanner and
  offline installation require a secure (HTTPS) origin, which is awkward on a LAN
  that has no public domain and no public certificate authority.
* **Deliberately modest scale.** This serves one household. A local database and a
  single host are correct product constraints here, not a claim that the same
  design should serve an internet-scale application.

## Architecture

Binventory is a Next.js 15 application using the App Router, written in
TypeScript with React, and styled with Tailwind CSS v4. Persistence is a local
SQLite database accessed through Prisma, with schema changes managed as versioned
migrations.

The domain model is the heart of it. A **label** is either a *container* (a bin,
drawer, or box that holds items) or a *single item* (like an appliance), and both
get printable QR codes. Labels live in rooms; items live in containers; and a
**manuals library** links PDF manuals and links to any number of labels and items
through a many-to-many relationship, so one furnace manual can belong to both the
furnace and the utility closet without duplication. On top of that sits an
appliance passport (model and serial numbers, purchase and warranty dates, and a
dated maintenance log) and a consumables model that tracks stock levels and
generates a shopping list automatically.

Because there are no accounts, every label keeps an **append-only activity
history**, and the home page shows a recent-activity feed across the whole house.
It is a convenience log rather than an audit trail, so it records what happened
without recording who did it, and it makes an accidental change easy to spot and
undo.

Two capabilities run as on-device AI rather than cloud calls. A local semantic
search matches by meaning as you type, is tolerant of typos, and never sends a
query off the machine. A vision assistant powers batch cataloging and
serial-number extraction: you photograph a shelf of items and the model proposes
what each one is, or re-reads existing photos to propose model and serial numbers.
Every proposal is reviewed and editable before it is applied, and a batch can be
undone in one step. The AI proposes; a human confirms.

The app serves a secure origin over the LAN using a certificate authority created
once for the household, whose keys never leave the machine; each phone enrolls
once, and the old insecure address permanently redirects so that already-printed
QR stickers keep working. It installs as a Progressive Web App with offline
support for pages already visited.

Development is spec-driven. Each feature area is a numbered specification folder
with its own plan and quickstart, so the requirements, the design, and the
verification steps for a feature live together and precede the code.

## Tradeoffs

**No accounts, an activity log instead of an audit trail.** Because the trust
boundary is the home network, adding logins would have been friction with no
security benefit for this deployment. The cost is that the app cannot attribute a
change to a person, so I chose an append-only, blame-free history that still makes
mistakes visible and reversible. It is the right trade for a household and the
wrong one for a shared public system, and I kept that boundary explicit.

**SQLite and a single local host over a managed database.** For one household on
one network, a local database removed all operational overhead and kept the data
private by construction. The trade is that this design does not scale horizontally
and was never meant to; I treated that as a deliberate product constraint rather
than a limitation to apologize for.

**On-device AI over cloud APIs.** Running the vision and search models on the
local machine keeps every photo and query inside the house and removes per-call
cost, at the expense of being bound by local hardware rather than a large hosted
model. To keep that honest, the AI never acts on its own: batch identification and
serial extraction always produce reviewable proposals, and nothing is written
until a person confirms it.

**A household certificate authority over plain HTTP or a public certificate.** A
secure origin is what unlocks the camera scanner and offline installation on
phones, and a LAN with no public domain cannot obtain a normal certificate. A
private certificate authority plus a one-time per-device enrollment buys a real
secure origin locally, at the cost of a short enrollment step on each new phone.

## Testing

The application uses a Vitest suite, run against a database that is separate from
both development and production. The spec-driven workflow is part of the testing
strategy: each feature's quickstart is a written procedure I validate the feature
against, so acceptance is defined before the code is written rather than
rationalized after it.

Data safety gets particular care because a home inventory is only useful if it is
trustworthy. Development, test, and production each use their own database file, so
schema experiments never touch live data; migrations are exercised against a
throwaway snapshot before they are deployed; and a nightly backup export runs on a
schedule with the application surfacing how fresh the most recent backup is.

## Results

Binventory is a working, installed application that the household uses. Printed QR
stickers open the right page on any phone on the network, manuals and warranties
and consumables live in one place instead of scattered across drawers and inboxes,
and cataloging a shelf is a matter of taking photos and confirming what the
on-device assistant proposes.

Its stickers survived a migration of the app's own address because the old origin
permanently redirects to the secure one, so nothing printed had to be reprinted.
Search finds things by meaning without anything leaving the house, and the
recent-activity feed has already earned its place by making an accidental archive
easy to notice and restore.

It remains a private project under active development, and I describe it here at
the level of its architecture and engineering decisions rather than through
screenshots of a real home.

## What I'd Change and What I Learned

The clearest lesson was how much leverage a precise domain model carries. Getting
the label-versus-item distinction and the many-to-many manuals relationship right
early made later features (consumables, the appliance passport, the activity feed)
feel like small additions rather than structural changes. When I was tempted to
shortcut the model, that was exactly when I should have slowed down.

The second lesson was that on-device AI is most useful when it is bounded. The
vision assistant is valuable precisely because it proposes rather than decides, and
because a person reviews every batch before it is written. If I extended it, I
would keep that shape and resist letting the model write directly to the database,
however confident it seemed.

If I were starting over, I would define the backup and restore procedure, the
dev-test-production data separation, and the secure-origin story before building
features rather than alongside them. Those operational concerns are what make a
household actually trust the app with the real contents of their home, and they
deserved to be first-class from the first commit.
