# Zound

Zound is a fucking browser based music player built with **HTML, CSS, and Vanilla JavaScript**, ginawa kasi apparently enough na yung Spotify ads para mapuno ang pasensya ko. So instead of continuing to suffer, gumawa ako ng sariling music player para sa local music library ko. Walang account, walang subscription, walang ads, at walang random server na kailangan mong pag uploadan ng music mo. Your music stays on your device. Basically, Spotify kung tinanggal mo yung corporate bullshit.

**Project Status:** STILL WORKING / BUT ABANDONED

**CLICK ME:** https://lilbuffy.github.io/Zound/

**WARNING:** Your antivirus or browser security might randomly flag the website as suspicious. Relax, hindi ko ninanakaw yung fucking MP3s mo. Pero syempre, huwag pa rin maging tanga at blindly trust random websites. Check the repository if you're unsure.

## What This Shit Can Do

Zound supports local music playback for formats supported by the browser, including **MP3, M4A, WAV, OGG, and AAC**. You can create, rename, and delete playlists, add or remove songs, play entire playlists, shuffle tracks, favorite songs, search by title, artist, or album, and view recently played tracks. Basically, kung may 500 songs ka na at naging fucking archaeological expedition na ang paghanap ng isang kanta, may search na.

Playback controls include play and pause, previous and next tracks, seeking, shuffle, repeat all or one, and volume control. Desktop users can also preview songs on hover when supported, while devices without hover get an alternative interaction. Browser autoplay restrictions are respected because apparently browsers also enjoy telling developers **NO**.

## Local Data

Zound keeps playlists, favorites, recently played songs, playback preferences, and volume settings locally using **LocalStorage and IndexedDB**. Walang backend database bullshit and no account is required. Your music library stays on your device instead of being uploaded somewhere random.

## Tech Stack

**HTML5, CSS3, Vanilla JavaScript, Web Audio API, LocalStorage, and IndexedDB.**

No giant framework. No backend. No database server. Just browser APIs doing the heavy lifting while I pretend this was a completely reasonable thing to build.

## Test Library

The project includes a small test library containing my favorite five tracks from **The Birthday Massacre** that were used during development and testing. These tracks are only there as test content for the player.
