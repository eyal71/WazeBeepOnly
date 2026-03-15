# Waze Beep-Only Customizer 🚗🔇

A simple web tool to generate custom Waze voice packs that only give "beep" alerts for the events you care about, keeping your drive quiet and distraction-free.

👉 **[Try it out here](https://eyal71.github.io/WazeBeepOnly/)** *(Note: The interface loads in Hebrew by default. Click the "EN" button in the top-left corner to switch to English).*

## The Backstory

Today, like most of us, I drive with Waze always on, even when I know the route perfectly. The problem? I don't want to hear all the spoken instructions and chatter. I just want a simple "beep" for specific alerts that matter to me. 

It turns out I'm not alone. There's a long-standing request in the [Waze Suggestion Box](https://waze.uservoice.com/forums/59223-waze-suggestion-box/suggestions/4300357-add-beep-only-option-to-the-sound-options?page=2&per_page=20) asking for this exact feature. Since we're still waiting for an official solution, I decided to build one.

## How It Was Built (A "Vibe Coding" Tale) 🤖
This project was written with the help of **Claude Code**.
At first, Claude insisted that the only way to do this was to install audio files directly into the Android OS. 

The turning point was when I found and pointed Claude to another GitHub project: [pipeeeeees/waze-voicepack-links](https://github.com/pipeeeeees/waze-voicepack-links). Once Claude saw how Waze voice packs actually work (using deep links), it finally understood the context and built the tool correctly. Human intuition for the win!

## Features
* Choose exactly which events trigger a "beep" (or two).
* Mute all other unnecessary spoken instructions.
* Installs your custom voice pack directly to the Waze app via a generated link.

## Acknowledgments
* Huge thanks to [pipeeeeees](https://github.com/pipeeeeees/waze-voicepack-links)

## Author
Created by **Eyal Saadon**. 

## License
This project is licensed under the GPL-3.0 License.
