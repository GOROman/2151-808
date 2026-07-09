// Minimal C ABI wrapper around ymfm's YM2151 (OPM) core for WebAssembly.
//
// Instead of ymfm::ym2151 (which mixes all channels), we drive the FM engine
// directly so each of the 8 channels can be output separately — the worklet
// mixes them with per-instrument pan/level like a mixer.
#include "ymfm/src/ymfm_opm.h"
#include "ymfm/src/ymfm_fm.ipp" // template definitions for fm_engine_base

#include <cstdint>

namespace {

class opm_interface : public ymfm::ymfm_interface
{
};

using opm_engine = ymfm::fm_engine_base<ymfm::opm_registers>;

opm_interface g_iface;
opm_engine g_fm(g_iface);

constexpr uint32_t CLOCK = 3579545; // standard 3.579545 MHz master clock
constexpr uint32_t MAX_FRAMES = 4096;
constexpr uint32_t NUM_CH = 8;
// per frame: 8 channels x stereo
float g_buffer[MAX_FRAMES * NUM_CH * 2];

} // namespace

extern "C" {

// Returns the chip's native output sample rate (clock / 64).
uint32_t opm_init()
{
    g_fm.reset();
    return g_fm.sample_rate(CLOCK);
}

void opm_write(uint32_t reg, uint32_t val)
{
    g_fm.write(static_cast<uint16_t>(reg), static_cast<uint8_t>(val));
}

float *opm_buffer()
{
    return g_buffer;
}

// Generates `frames` frames; each frame is 16 floats (ch0 L, ch0 R, ch1 L, …).
void opm_generate(uint32_t frames)
{
    if (frames > MAX_FRAMES)
        frames = MAX_FRAMES;
    for (uint32_t i = 0; i < frames; i++)
    {
        g_fm.clock(opm_engine::ALL_CHANNELS);
        for (uint32_t ch = 0; ch < NUM_CH; ch++)
        {
            opm_engine::output_data out;
            out.clear();
            g_fm.output(out, 0, 32767, 1u << ch);
            g_buffer[(i * NUM_CH + ch) * 2 + 0] = static_cast<float>(out.data[0]) * (1.0f / 32768.0f);
            g_buffer[(i * NUM_CH + ch) * 2 + 1] = static_cast<float>(out.data[1]) * (1.0f / 32768.0f);
        }
    }
}

} // extern "C"
