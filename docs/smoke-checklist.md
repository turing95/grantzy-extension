# Grantzy Extension Smoke Checklist

Use this checklist before and after each hardening phase.

## Baseline Checkpoint (Pre-change)
- [x] `npm run build` succeeds
- [x] `npm run lint` succeeds
- [x] `npm run test` succeeds
- [ ] Load unpacked extension in Chrome without manifest errors

## Webapp Integration
- [ ] On Grantzy webapp, click the open-extension trigger button.
- [ ] Side panel opens successfully.
- [ ] If a space UUID is present, selected application preload still works.

## Core Side Panel Flow
- [ ] Search applications works.
- [ ] Selecting an application loads its fields.
- [ ] Search within fields returns results.
- [ ] Click-to-copy still works.

## Autofill Flow
- [ ] Analyze current tab form works.
- [ ] Preview plan builds.
- [ ] Fill all applies values.
- [ ] Undo restores previous values.

## Permission Flow
- [ ] On a site without prior permission, runtime host permission request appears.
- [ ] After granting, analyze/fill works.

## Stability
- [ ] No uncaught runtime errors in service worker during normal use.
- [ ] No uncaught runtime errors in side panel during normal use.

## Post-phase Gate
For every phase, run:
- [x] `npm run check`
- [x] `npm run build`
- [ ] Manual smoke pass for affected flows only
