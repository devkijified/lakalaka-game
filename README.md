# Lakalaka

Lakalaka is a browser multiplayer version of Suwe, the Nigerian chalk tiles game. Two to four real players play in one room on their own phones or computers. No signup, no accounts.

## Run it locally

1. Install once: `npm install`
2. Start the server: `npm start`
3. The server prints its port, 4173 by default. Open `http://localhost:4173` on your computer.
4. To play on phones on the same wifi, find your computer local IP address (for example 192.168.1.20) and open `http://192.168.1.20:4173` on each phone. One player creates a room and shares the 4 letter code, everyone else joins with that code.

## How a game is played

1. Create a room and share the code. The host starts when at least 2 players are in, up to 4.
2. On your turn, tap Throw to stop the power meter. Stopping in the middle green band lands your seed clean in your target box. Stopping just outside it lands on the line, a foul. Stopping far out misses, also a foul. A foul ends your turn.
3. After a clean throw, hop: tap the boxes in order. Go up the board 1 to 7 in snake order, skip the box holding your seed, rest in box 7 at the top, hop back down, and tap the seed box last to pick it up on one leg.
4. A clean run moves your target up one box, from 1 toward 6. Tapping the wrong box, or a box owned by an opponent, is a foul and ends your turn.
5. Finish a run on box 6 and you get one blind back throw. Tap Claim to stop the marker. If it stops on a free box, that box becomes your house, marked with your name and colour. You can rest in your own houses, opponents cannot step into them.
6. When all 6 boxes are houses, the game ends. The player with the most houses wins. If tied, the player who claimed their last house earliest wins. Tap Play again to return to the lobby with the same players.

Board numbering: box 1 bottom left, 2 bottom right, 3 middle right, 4 middle left, 5 top left, 6 top right, and box 7 is the big rest box across the top.

## What changed in v2: a real 3D simulation

The first version drew a flat figure over a flat board and was rejected for it. V2 rebuilt the whole game view as a 3D simulation with Three.js (the library is vendored locally in `public/vendor/`, no CDN): a chalk Suwe court on a warm earth ground plane in perspective, daylight with soft shadows, a low compound wall and a tree at the far edge, chalk lines and numbers as a procedural canvas texture, houses tinting their box with the owner name chalked in. Movement became simulated and physically timed: parabolic hops and stone flights, dust puffs, a following camera, raycast box taps. The v2 figure itself was a stylised body assembled from capsules and a lathe turned torso, and it was rejected for exactly that: it read as geometry, a dummy, not a person.

## What changed in v3: a real humanoid character

The v3 figure is a real skinned human model. No part of her body is built from primitives, and no primitive built figure stands anywhere in the game, active player or waiting players.

* **The character** is Michelle, a Mixamo character distributed with the three.js examples, downloaded from `https://cdn.jsdelivr.net/gh/mrdoob/three.js@r186/examples/models/gltf/Michelle.glb` and served locally as `public/models/human.glb`, so the game has no runtime CDN dependency. She is ONE skinned mesh: dark skin, natural hair puffs, a face with sunglasses, headphones, a grey crop top, baggy yellow pants and trainers, with shaped hands and feet, scaled to 1.75 world units tall with her feet planted on the ground. The other two candidates were judged from screenshots and rejected: Soldier is a sci-fi soldier sealed in combat armour with a visor instead of a face, and Xbot is a faceless pink jointed mannequin, exactly the dummy look that was banned.
* **The rig** is her own 65 bone Mixamo skeleton (`mixamorigHips`, `mixamorigSpine`, `mixamorigLeftArm`, and so on). Waiting players are skeleton clones of the same model standing at the side of the court in idle. Nothing tints the textured model a flat colour: player identity is the name label and the court side only.
* **Animation layering.** The existing physics and timing from v2 are untouched: the root group travels box to box on the hop arc, the stone flies its parabola, the camera follows as before. Each frame the state machine's pose is applied to the skeleton as delta rotations multiplied onto each bone's bind pose, with spine bends distributed across the spine chain so she curves instead of hinging, and crouch drops moving the hips bone straight down in world space. The model ships no idle or walk clip (only a samba dance and its bind pose), so idle and rest are the neutral bind pose with arms lowered by delta plus breathing on the spine bones. In the air the free leg tucks up behind with the knee bent and the support leg extends with the toe pointed, arms out for balance; the throw sweeps the throwing arm low and forward (retuned to an underhand drop toss in v4, see below), and the stone launches from the right hand bone's world position; the pickup bends the spine and hips forward with the arm reaching down; a foul rolls the hips, throws both arms wide and windmills them; the house claim turns her back to the board and throws over her head.
* **Licensing note.** The character comes from the three.js examples (a Mixamo character). Its licensing must be confirmed before any public commercial launch of this game.

## What changed in v4: motion tuned from real Suwe gameplay

The v4 motion pass retuned the simulation against real Suwe gameplay videos watched frame by frame (full study: `~/workspace/research_notes/suwe-video-study-20261026.md`). One tutorial in the study even names the game both ways ("Suwe... some people call it laka laka"), confirming the two names are the same game. What the videos measured, and what the simulation now does:

* **Throw.** A gentle underhand drop toss from the start edge: shallow crouch, the throwing arm hangs down and sweeps low forward, the seed leaves the wrist at waist height on a flat arc (apex 0.22 to 0.55 world units above the release, a bit higher for far boxes) with a flight of about 0.4 to 0.7 seconds.
* **The landing is true to the power the player stopped at.** The server now reports the exact meter power with every throw, and the seed lands where that power sends it: power 50 is the heart of the box; the clean band hugs the missed edge; the pale band comes down on the chalk line itself; a bigger miss falls short in the dirt or sails past the box, as far out as the power was too much. On dirt the seed stops dead where it lands: no bounce chain, no rolling. Only a hard miss skids a few centimetres.
* **Hops.** Quicker and lower, about 0.6 seconds per hop with the figure rising only about 0.18 world units, landing near flat footed, free leg folded back, arms down at the sides with small swings. Wide arms are kept for the balance recovery foul only, which is where real players throw them out too.
* **Box 7 turnaround.** A standing pivot in place, about half a second, feet planted in the rest box with a small knee bend mid turn, before hopping back. No more turning inside the hop.
* **Pickup.** The signature move, rebuilt as played: balance on one leg for about a second, fold deep from the waist until the back is near horizontal, the free leg extended back and up as a counterweight, one arm reaching down to the seed, the other out to the side, with a visible balance wobble part way down.
* **Meter.** The throw needle also moves slower than before (a full sweep takes about 2.5 seconds), so stopping in the green is a skill, not a reflex test.

## Test

With the server running (`npm start` in one terminal), run `node test-multiplayer.mjs` in another. It connects two test players, plays one clean run and one foul, and prints PASS or FAIL for each check.

For the 3D view, run `node test-browser.mjs`. It opens two real pages at 390 by 844 (player and spectator, using the Chrome in the mobile rig folder), plays a full clean run by tapping the 3D boxes at their screen coordinates, and asserts the figure leaves the start edge, passes through an airborne phase on both pages, lands in every box in order, rests in box 7, picks the seed up and walks home, with zero page errors. It also saves the screenshots named `v3-idle-390x844.png`, `v3-hop-390x844.png`, `v3-rest-390x844.png`, `v3-throw-390x844.png` and a close portrait `v3-face-390x844.png`.

## Deploy note

Host it on any Node host (Render, Railway, Fly, a VPS, or similar). Run `npm install` then `npm start`, and set the `PORT` environment variable to whatever the host gives you. The client and the WebSocket connect on the same origin and the same port, so no extra WebSocket setup is needed.
