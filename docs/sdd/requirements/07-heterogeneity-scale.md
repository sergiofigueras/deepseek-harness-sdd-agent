# SDD 07 - Heterogeneous surfaces and multi-tenant reuse

Source: assignment 3.7. Criterion: AC-008.

## Surface seam

The orchestration and artifact use semantic `SurfaceAction`, `Observation`, and `LocatorBundle` types. Playwright is one adapter. A legacy desktop adapter can map role/name candidates to accessibility-tree nodes and coordinate/image candidates without changing discovery, replay, policy, handoff, or results.

## Reuse model

Artifacts identify vendor product and compatible version range, not a single institution. Tenant profiles supply allowed base URLs, non-sensitive branding hints, and signed locator overlays. Overlays are narrow: candidate locators and route templates only. Drift fingerprints combine app version hints, landmark/control names, and checkpoint structure. A mismatch blocks unattended replay and asks for review; successful repeated replay can raise confidence but cannot silently approve semantic changes.

## Cuts

No tenant registry, signing service, desktop driver, or fleet telemetry is built. The contracts and overlay validator are implemented so those systems can be added without changing the capability contract.

## Evidence

Tests show a base artifact applied to two local tenant variants using a locator overlay and reject an overlay that changes the action or risk level.
