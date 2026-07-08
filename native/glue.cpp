// Minimal C ABI wrapper around ymfm's YM2151 (OPM) core for WebAssembly.
#include "ymfm/src/ymfm_opm.h"

#include <cstdint>

namespace {

class opm_interface : public ymfm::ymfm_interface
{
};

opm_interface g_iface;
ymfm::ym2151 g_chip(g_iface);

constexpr uint32_t CLOCK = 3579545; // standard 3.579545 MHz master clock
constexpr uint32_t MAX_FRAMES = 4096;
float g_buffer[MAX_FRAMES * 2];

} // namespace

extern "C" {

// Returns the chip's native output sample rate (clock / 64).
uint32_t opm_init()
{
    g_chip.reset();
    return g_chip.sample_rate(CLOCK);
}

void opm_write(uint32_t reg, uint32_t val)
{
    g_chip.write_address(static_cast<uint8_t>(reg));
    g_chip.write_data(static_cast<uint8_t>(val));
}

float *opm_buffer()
{
    return g_buffer;
}

// Generates `frames` stereo frames into g_buffer (interleaved L/R floats).
void opm_generate(uint32_t frames)
{
    if (frames > MAX_FRAMES)
        frames = MAX_FRAMES;
    ymfm::ym2151::output_data out;
    for (uint32_t i = 0; i < frames; i++)
    {
        g_chip.generate(&out);
        g_buffer[i * 2 + 0] = static_cast<float>(out.data[0]) * (1.0f / 32768.0f);
        g_buffer[i * 2 + 1] = static_cast<float>(out.data[1]) * (1.0f / 32768.0f);
    }
}

} // extern "C"
