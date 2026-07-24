# Changelog

All notable changes to ConvoSketchpad are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-07-24

### Added

- A visual Canvas with multiple root branches, Continue and Fork workflows, persistent layout, localized controls, and one selected OpenClaw Agent per Canvas.
- Durable, owner-scoped attachments and generated Artifacts.
- Managed-user Token authentication, session revocation, request throttling, and Canvas owner isolation.
- Native OpenClaw device pairing and configuration through supported CLI commands.
- Session reset prediction, transcript reconciliation, and canonical Branch recovery.
- Release-only updater and platform service integration for supported macOS and Linux installs.
- Product artwork for the application icon, Apple Touch Icon, and favicon.

### Changed

- Established ConvoSketchpad as an independently maintained product on the `main` branch.
- Renamed runtime paths, services, launchd identifiers, and environment variables for ConvoSketchpad.
- Separated browser and Node test environments.
- Unified product copy around “A branching AI workspace for visual thinkers” and consolidated the project documentation.
- Made the application version reported to OpenClaw derive from package metadata.
- Changed the installer to use official stable Releases by default and require an explicit `--branch` option for development installs.
- Updated the Hono server adapter and other direct and transitive dependencies to patched versions.

### Fixed

- Prevented the first ConvoSketchpad Release notes from being generated against inherited OpenClaw Nerve tags.
- Removed legacy runtime log prefixes and stale release-version examples.

### Security

- Removed an unused development CLI that retained vulnerable server dependencies.
- Added full and production dependency audits to the Release validation gate.

### Upgrade notes

- Back up the project-local `database/` and `artifacts/` directories together before upgrading an existing installation.
- Version `0.2.0` does not require a manual database migration.

ConvoSketchpad is derived from OpenClaw Nerve. Earlier upstream release history remains available in the [OpenClaw Nerve changelog](https://github.com/daggerhashimoto/openclaw-nerve/blob/master/CHANGELOG.md).

[Unreleased]: https://github.com/MrToyy/convosketchpad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MrToyy/convosketchpad/releases/tag/v0.2.0
