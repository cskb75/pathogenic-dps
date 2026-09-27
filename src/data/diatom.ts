// The Diatom's starting body, transcribed from the slot menu screenshot on the
// wiki.gg Diatom page (the Diatom isn't in the demo build). Slot positions are
// measured from the screenshot at about 1.28 screenshot pixels per game pixel,
// so they're approximate; the connections are exact. Evolutions need the full
// game's files.

import type { BodyPlan } from '../engine/types';

export const diatomStart: BodyPlan = {
  "id": "diatom-start",
  "name": "Starting body",
  "tier": 0,
  "slots": [
    {
      "id": "ESlot1",
      "kind": "external",
      "x": -1.756,
      "y": -0.639,
      "r": -2.249
    },
    {
      "id": "ESlot2",
      "kind": "external",
      "x": -0.589,
      "y": -0.578,
      "r": -0.696
    },
    {
      "id": "ESlot3",
      "kind": "external",
      "x": -1.766,
      "y": 0.65,
      "r": 2.22
    },
    {
      "id": "ESlot4",
      "kind": "external",
      "x": -0.678,
      "y": 0.599,
      "r": 0.819
    },
    {
      "id": "ESlot5",
      "kind": "external",
      "x": 0.589,
      "y": -0.577,
      "r": -2.446
    },
    {
      "id": "ESlot6",
      "kind": "external",
      "x": 1.757,
      "y": -0.64,
      "r": -0.893
    },
    {
      "id": "ESlot7",
      "kind": "external",
      "x": 0.683,
      "y": 0.6,
      "r": 2.319
    },
    {
      "id": "ESlot8",
      "kind": "external",
      "x": 1.769,
      "y": 0.65,
      "r": 0.919
    },
    {
      "id": "ISlot1",
      "kind": "internal",
      "x": -1.257,
      "y": -0.02,
      "r": 0
    },
    {
      "id": "ISlot2",
      "kind": "internal",
      "x": 0.0,
      "y": 0.101,
      "r": 0
    },
    {
      "id": "ISlot3",
      "kind": "internal",
      "x": 1.258,
      "y": -0.02,
      "r": 0
    }
  ],
  "links": [
    [
      "ESlot1",
      "ISlot1"
    ],
    [
      "ESlot2",
      "ISlot1"
    ],
    [
      "ESlot3",
      "ISlot1"
    ],
    [
      "ESlot4",
      "ISlot1"
    ],
    [
      "ESlot5",
      "ISlot3"
    ],
    [
      "ESlot6",
      "ISlot3"
    ],
    [
      "ESlot7",
      "ISlot3"
    ],
    [
      "ESlot8",
      "ISlot3"
    ],
    [
      "ISlot1",
      "ISlot2"
    ],
    [
      "ISlot2",
      "ISlot3"
    ]
  ],
  "outline": [],
  "sprite": {
    "src": "art/bodies/diatom-start.webp",
    "x": -2.27,
    "y": -1.028,
    "w": 4.53,
    "h": 2.07
  }
};
