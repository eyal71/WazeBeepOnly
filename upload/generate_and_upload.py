"""
WazeBeepOnly - Generate beep MP3s and upload to Waze.
Usage: python generate_and_upload.py [config.json]
"""

import base64
import json
import os
import sys
import tarfile
import tempfile
import time
import uuid

import numpy as np
import requests
import blackboxprotobuf
from pydub import AudioSegment

# ── Config ─────────────────────────────────────────────────────────

CONFIG_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "beep_config.json")

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    CONFIG = json.load(f)

PACK_NAME = CONFIG.get("pack_name", "BeepOnly")
EVENTS    = CONFIG["events"]

# ── Audio generation ───────────────────────────────────────────────

SR       = 8000
FREQ     = 880
BEEP_MS  = 140
GAP_MS   = 110
FADE_MS  = 12

def _make_beep_segment(freq=FREQ, duration_ms=BEEP_MS):
    n     = int(SR * duration_ms / 1000)
    fade  = int(SR * FADE_MS / 1000)
    t     = np.linspace(0, duration_ms / 1000, n, endpoint=False)
    wave  = np.sin(2 * np.pi * freq * t)
    env   = np.ones(n)
    env[:fade]  = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    samples = (wave * env * 13000).astype(np.int16)
    return AudioSegment(samples.tobytes(), frame_rate=SR, sample_width=2, channels=1)

def generate_silence():
    return AudioSegment.silent(duration=50, frame_rate=SR)

def generate_beep(count):
    seg = _make_beep_segment()
    gap = AudioSegment.silent(duration=GAP_MS, frame_rate=SR)
    result = seg
    for _ in range(count - 1):
        result = result + gap + _make_beep_segment()
    return result

AUDIO_CACHE = {}

def get_audio(sound_type):
    if sound_type not in AUDIO_CACHE:
        if sound_type == "beep1":
            AUDIO_CACHE[sound_type] = generate_beep(1)
        elif sound_type == "beep2":
            AUDIO_CACHE[sound_type] = generate_beep(2)
        else:
            AUDIO_CACHE[sound_type] = generate_silence()
    return AUDIO_CACHE[sound_type]

def generate_mp3_files(output_dir):
    print(f"🎵 Generating {len(EVENTS)} MP3 files...")
    for filename, sound_type in EVENTS.items():
        audio = get_audio(sound_type)
        path  = os.path.join(output_dir, f"{filename}.mp3")
        audio.export(path, format="mp3", bitrate="64k",
                     parameters=["-ar", str(SR), "-ac", "1"])
    total_kb = sum(os.path.getsize(os.path.join(output_dir, f))
                   for f in os.listdir(output_dir)) / 1024
    print(f"✅ Generated {len(EVENTS)} files  ({total_kb:.1f} KB total)")

# ── Waze upload (adapted from pipeeeeees/waze-voicepack-links) ─────

def _decode_hex_protobuf(hex_string):
    message, _ = blackboxprotobuf.protobuf_to_json(base64.b16decode(hex_string, True))
    return json.loads(message)

def _encode_proto_base64(data, typedef):
    encoded = blackboxprotobuf.encode_message(data, typedef)
    return "ProtoBase64," + base64.b64encode(encoded).decode("utf-8")

def _waze_login():
    u1, u2, u3 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())

    main_typedef = {'1001': {'type': 'message', 'message_typedef': {'2184': {'type': 'message', 'message_typedef': {'1': {'type': 'int', 'name': ''}, '3': {'type': 'bytes', 'name': ''}, '5': {'type': 'bytes', 'name': ''}, '6': {'type': 'bytes', 'name': ''}, '11': {'type': 'bytes', 'name': ''}, '16': {'type': 'bytes', 'name': ''}, '17': {'type': 'bytes', 'name': ''}, '18': {'type': 'int', 'name': ''}, '19': {'type': 'int', 'name': ''}, '22': {'type': 'message', 'message_typedef': {'1': {'type': 'message', 'message_typedef': {'1': {'type': 'bytes', 'name': ''}, '2': {'type': 'bytes', 'name': ''}}, 'name': ''}}, 'name': ''}, '24': {'type': 'message', 'message_typedef': {'1': {'type': 'int', 'name': ''}, '2': {'type': 'int', 'name': ''}, '3': {'type': 'int', 'name': ''}}, 'name': ''}, '25': {'type': 'bytes', 'name': ''}, '26': {'type': 'bytes', 'name': ''}, '28': {'type': 'int', 'name': ''}}, 'name': ''}}, 'name': ''}}
    p2_typedef   = {'1001': {'type': 'message', 'message_typedef': {'2219': {'type': 'message', 'message_typedef': {}, 'name': ''}}, 'name': ''}}
    p3a_typedef  = {'1001': {'type': 'message', 'message_typedef': {'2744': {'type': 'message', 'message_typedef': {'1': {'type': 'message', 'message_typedef': {'1': {'type': 'bytes', 'name': ''}, '2': {'type': 'bytes', 'name': ''}}, 'name': ''}, '3': {'type': 'int', 'name': ''}, '4': {'type': 'int', 'name': ''}, '5': {'type': 'int', 'name': ''}}, 'name': ''}}, 'name': ''}}
    p3b_typedef  = {'1001': {'type': 'message', 'message_typedef': {'2108': {'type': 'message', 'message_typedef': {'1': {'type': 'bytes', 'name': ''}, '2': {'type': 'int', 'name': ''}}, 'name': ''}}, 'name': ''}}

    main_data = {"1001": {"2184": {"1": 234, "3": "4.106.0.1", "5": "Waydroid", "6": "WayDroid x86_64 Device", "11": "11-SDK30", "16": "en", "17": u1, "18": 50, "19": 1, "22": {"1": {"1": "uid_enabled", "2": "true"}}, "24": {"1": 2, "2": 1920, "3": 1137}, "25": "en", "26": u2, "28": int(time.time())}}}
    p2_data  = {"1001": {"2219": {}}}
    p3a_data = {"1001": {"2744": {"1": {"1": "worldDATA", "2": "RANDSTRINGDATA"}, "3": 0, "4": 0, "5": 1}}}
    p3b_data = {"1001": {"2108": {"1": u3, "2": 1}}}

    headers = {"user-agent": "4.106.0.1", "sequence-number": "1",
               "x-waze-network-version": "3", "x-waze-wait-timeout": "3500"}
    jar = requests.cookies.RequestsCookieJar()

    # Step 1
    r1 = requests.post("https://rt.waze.com/rtserver/distrib/login",
                       data=_encode_proto_base64(main_data, main_typedef) + "\nGetGeoServerConfig,world,T",
                       headers=headers, cookies=jar)
    if r1.status_code != 200:
        raise RuntimeError(f"Login step 1 failed: {r1.status_code}")

    # Step 2
    headers["sequence-number"] = "2"
    main_data["1001"]["2184"]["28"] = int(time.time())
    r2 = requests.post("https://rtproxy-row.waze.com/rtserver/distrib/static",
                       data=_encode_proto_base64(main_data, main_typedef) + "\n" +
                            _encode_proto_base64(p2_data, p2_typedef),
                       headers=headers, cookies=jar)
    jar.update(r2.cookies)
    r2_data = _decode_hex_protobuf(r2.content.hex())
    anon_user = r2_data["1001"][1]["2220"]["1"]
    anon_pass = r2_data["1001"][1]["2220"]["2"]

    # Step 3
    headers["sequence-number"] = "3"
    main_data["1001"]["2184"]["28"] = int(time.time())
    p3a_data["1001"]["2744"]["1"]["1"] = anon_user
    p3a_data["1001"]["2744"]["1"]["2"] = anon_pass
    r3 = requests.post("https://rtproxy-row.waze.com/rtserver/distrib/login",
                       data=_encode_proto_base64(main_data, main_typedef) + "\n" +
                            _encode_proto_base64(p3a_data, p3a_typedef) + "\n" +
                            _encode_proto_base64(p3b_data, p3b_typedef),
                       headers=headers, cookies=jar)
    jar.update(r3.cookies)
    r3_data = _decode_hex_protobuf(r3.content.hex())

    auth_token   = r3_data["1001"][1]["2745"]["1"]["3"]
    global_server = r3_data["1001"][1]["2745"]["1"]["2"]
    user_id      = int(r3_data["1001"][1]["2745"]["1"]["1"])

    # Build UID header
    bin_id = bin(user_id)[2:].zfill(31)
    id_bytes = [b'12']
    first = hex(int(bin_id[:3], 2))[2:].zfill(2)
    id_bytes.append(bytes('0' + first, 'raw_unicode_escape'))
    remaining = bin_id[3:]
    for i in range(4):
        chunk = remaining[i*7:(i+1)*7]
        id_bytes.append(bytes(hex(int("1" + chunk, 2))[2:], 'raw_unicode_escape'))
    id_bytes.append(b'08')
    id_bytes = list(reversed(id_bytes))
    raw_id = bytes("".join(chr(int(b, 16)) for b in id_bytes), 'raw_unicode_escape')

    tok_len_hex = hex(len(auth_token))[2:]
    tok_len_bytes = bytes([int(tok_len_hex[i:i+2], 16) for i in range(0, len(tok_len_hex), 2)])
    uid_raw = raw_id.decode("raw_unicode_escape") + tok_len_bytes.decode() + auth_token
    uid = base64.b64encode(uid_raw.encode("raw_unicode_escape"))

    headers["uid"] = uid
    headers["sequence-number"] = "4"
    return headers, global_server, jar


def upload_to_waze(mp3_dir, pack_name):
    print("🔐 Authenticating with Waze...")
    headers, global_server, jar = _waze_login()

    pack_uuid = str(uuid.uuid4())
    print(f"📦 Pack UUID: {pack_uuid}")

    # Create tar.gz in memory
    print("🗜  Compressing MP3s...")
    import io
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for fname in os.listdir(mp3_dir):
            fpath = os.path.join(mp3_dir, fname)
            if os.path.isfile(fpath):
                tar.add(fpath, arcname=fname)
    tar_bytes = buf.getvalue()

    # Encode and upload
    voice_typedef = {'1001': {'type': 'message', 'message_typedef': {'2343': {'type': 'message', 'message_typedef': {'2': {'type': 'message', 'message_typedef': {'1': {'type': 'bytes', 'name': ''}, '2': {'type': 'bytes', 'name': ''}, '5': {'type': 'bytes', 'name': ''}, '12': {'type': 'int', 'name': ''}}, 'name': ''}, '3': {'type': 'bytes', 'name': ''}}, 'name': ''}}, 'name': ''}}}
    voice_data = {'1001': {'2343': {'2': {'1': pack_uuid.encode(), '2': pack_name.encode(), '5': global_server.encode(), '12': 0}, '3': tar_bytes}}}

    encoded = "ProtoBase64," + base64.b64encode(
        blackboxprotobuf.encode_message(voice_data, voice_typedef)
    ).decode("utf-8")

    print("⬆️  Uploading to Waze servers...")
    r = requests.post("https://rtproxy-row.waze.com/rtserver/distrib/command",
                      headers=headers, data=encoded, cookies=jar)
    if r.status_code != 200:
        raise RuntimeError(f"Upload failed: {r.status_code} {r.text}")

    return pack_uuid


# ── Main ───────────────────────────────────────────────────────────

def main():
    print(f"🚀 WazeBeepOnly - generating pack: {PACK_NAME}\n")

    with tempfile.TemporaryDirectory() as tmp:
        generate_mp3_files(tmp)
        pack_uuid = upload_to_waze(tmp, PACK_NAME)

    install_link = f"https://waze.com/ul?acvp={pack_uuid}"
    download_url = f"https://voice-prompts-ipv6.waze.com/{pack_uuid}.tar.gz"

    print("\n" + "="*55)
    print("✅ DONE!")
    print(f"\n📱 Install link (open on your phone):")
    print(f"   {install_link}")
    print(f"\n📥 Direct download:")
    print(f"   {download_url}")
    print("="*55)

    # Write to file so GitHub Actions can output it
    with open("waze_link.txt", "w") as f:
        f.write(install_link)

if __name__ == "__main__":
    main()
