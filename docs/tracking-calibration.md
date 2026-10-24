# Optional Live face calibration

The Studio Live page can use a per-avatar calibration profile for eye openness and
smile strength. It does not change the tracking model, runtime API, avatar rig or
sprite files. Without an enabled profile, face tracking follows the existing path.

Open **Face and smile calibration** under the camera preview, choose **Load
calibration JSON**, and select a profile. Loading a valid profile enables it and
saves it for this avatar in this browser. The checkbox turns it off without
deleting the profile; **Remove calibration** deletes the saved selection. Nothing
starts the camera or microphone automatically.

Profiles are scoped by project and, when present, the avatar URL. Browser storage
may be unavailable; the current session can still use an imported profile.

## Profile format

The following values are illustrative, not universal defaults:

```json
{
  "version": 1,
  "config": {
    "neutralMouth": 0.000001,
    "floor": 0.00002,
    "exit": 0.00003,
    "enter": 0.00006,
    "gentle": 0.0003,
    "big": 0.9,
    "open": [0.1, 0.2],
    "closed": [0.65, 0.75],
    "enterSeconds": 0.1,
    "exitSeconds": 0.16,
    "riseSeconds": 0.08,
    "fallSeconds": 0.12
  }
}
```

`open` and `closed` are the raw `eyeBlinkLeft`/`eyeBlinkRight` endpoints, before
mirror is applied. Both eyes need a distinct open/closed range. The other amplitude
values describe the mean of `mouthSmileLeft` and `mouthSmileRight` minus
`neutralMouth`. Values must satisfy `floor < exit < enter < gentle < big`.
The curve maps the gentle anchor to 0.4 and the large smile anchor to 1. It uses
separate entry/release thresholds and durations. This is not a mouth-open hold
setting or an emotion classifier.

Only new tracking results advance the entry/release evidence. Invalid or missing
required scores, a long result gap, camera stop and stale results reset the
correction. Horizontal pose, mouth, eyebrows and microphone lip sync keep their
existing calculations. Only corrected motion parameters are relayed to the stream
page; the stream page does not need the profile or camera access.

The loader validates finite values, endpoint ranges and timing bounds, and accepts
at most 64 KiB. Unknown metadata is ignored. Invalid imports leave the current
profile intact and show an error.

## Install from a local link

An explicit `trackingProfile` query parameter can load a same-origin JSON file:

```text
/live.html?project=my-avatar&trackingProfile=/projects/my-avatar/tracking-calibration.json
```

External origins and redirects are rejected. After successful installation the
query parameter is removed from the current Live URL, so reloading preserves the
checkbox choice. A saved profile requires no extra requests when opening Live
normally. This parameter is not added to the OBS URL.

Calibration does not add half-eye or smile artwork. The avatar must contain the
appropriate sprites and rendering support to show those drawings. Individual
calibration values are browser settings, not currently part of the `.mavatar`
package format. Do not include personal profiles or source images in public
samples or this document.
