"""Generate the original 30-second instrumental bed; no external audio assets."""
import math
import struct
import sys
import wave

rate = 44100
seconds = 30
chords = [(130.81, 164.81, 196.00), (110.00, 130.81, 164.81),
          (87.31, 110.00, 130.81), (98.00, 123.47, 146.83)]
with wave.open(sys.argv[1], 'w') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(rate)
    data = bytearray()
    for i in range(rate * seconds):
        t = i / rate
        scene = int(t / 6) % 4
        chord = chords[scene]
        beat = t % .75
        step = int(t / .375)
        note = chord[step % 3] * 4
        decay = math.exp(-9 * (t % .375))
        fade = min(1, t / 1.5, (seconds - t) / 2)
        pad = sum(math.sin(2 * math.pi * frequency * t) for frequency in chord) * .035
        bell = (math.sin(2 * math.pi * note * t) + .22 * math.sin(4 * math.pi * note * t)) * decay * .07
        bass = math.sin(2 * math.pi * chord[0] / 2 * t) * .035
        kick = math.sin(2 * math.pi * 55 * beat) * math.exp(-beat * 28) * .07
        for pan in (-1, 1):
            sample = (pad + bass + kick + bell * (1 + pan * .15)) * fade
            data.extend(struct.pack('<h', int(max(-1, min(1, sample)) * 32767)))
    output.writeframes(data)
