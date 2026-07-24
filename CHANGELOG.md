# Changelog

All notable changes to ConvoSketchpad are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A visual Canvas with multiple root branches, Continue and Fork workflows, persistent layout, localized controls, and one selected OpenClaw Agent per Canvas.
- Durable, owner-scoped attachments and generated Artifacts.
- Managed-user Token authentication, session revocation, request throttling, and Canvas owner isolation.
- Native OpenClaw device pairing and configuration through supported CLI commands.
- Session reset prediction, transcript reconciliation, and canonical Branch recovery.
- Release-only updater and platform service integration for supported macOS and Linux installs.

### Changed

- Established ConvoSketchpad as an independently maintained product on the `main` branch.
- Renamed runtime paths, services, launchd identifiers, and environment variables for ConvoSketchpad.
- Separated browser and Node test environments.

ConvoSketchpad is derived from OpenClaw Nerve. Earlier upstream release history remains available in the [OpenClaw Nerve changelog](https://github.com/daggerhashimoto/openclaw-nerve/blob/master/CHANGELOG.md).
