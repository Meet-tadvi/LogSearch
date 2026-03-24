"""
gpu_check.py
============
Diagnose GPU availability and verify that Ollama is using the GPU.

Run with:
    python gpu_check.py

What it does:
    1. Checks if CUDA (NVIDIA GPU) is accessible via torch
    2. Prints GPU name, VRAM total / free
    3. Sends a test prompt to Ollama WITH num_gpu=99 and reports
       how many layers were offloaded to GPU (shown in Ollama logs)
    4. Prints a quick timing comparison hint
"""

import subprocess
import sys
import time

# ── 1. NVIDIA-SMI quick check ─────────────────────────────────────
print("=" * 60)
print("STEP 1 — nvidia-smi GPU info")
print("=" * 60)
try:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total,memory.free,utilization.gpu",
         "--format=csv,noheader,nounits"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode == 0:
        for line in result.stdout.strip().splitlines():
            name, total, free, util = [x.strip() for x in line.split(",")]
            print(f"  GPU      : {name}")
            print(f"  VRAM     : {int(total):,} MiB total  |  {int(free):,} MiB free")
            print(f"  GPU util : {util}%")
    else:
        print("  nvidia-smi failed:", result.stderr.strip())
except FileNotFoundError:
    print("  nvidia-smi not found — is the NVIDIA driver installed?")

# ── 2. PyTorch CUDA check ─────────────────────────────────────────
print()
print("=" * 60)
print("STEP 2 — PyTorch CUDA availability")
print("=" * 60)
try:
    import torch
    if torch.cuda.is_available():
        print(f"  ✅ CUDA available: {torch.cuda.get_device_name(0)}")
        print(f"     VRAM total : {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
        print(f"     VRAM free  : {(torch.cuda.mem_get_info()[0]) / 1024**3:.1f} GB")
    else:
        print("  ❌ CUDA not available — PyTorch is CPU-only build.")
        print("     Install CUDA PyTorch: pip install torch --index-url https://download.pytorch.org/whl/cu121")
except ImportError:
    print("  ⚠️  PyTorch not installed (optional — Ollama doesn't need it).")
    print("     Install with: pip install torch --index-url https://download.pytorch.org/whl/cu121")

# ── 3. Ollama GPU inference test ──────────────────────────────────
print()
print("=" * 60)
print("STEP 3 — Ollama GPU inference test")
print("=" * 60)

MODEL = "llama3.1"   # change if needed

try:
    import ollama

    print(f"  Sending test prompt to '{MODEL}' with num_gpu=99 ...")
    print("  (Watch 'ollama ps' in another terminal to see GPU layers)\n")

    start = time.perf_counter()

    response = ollama.chat(
        model=MODEL,

        # messages=[{"role": "user", "content": "can you make regex pattern for these log file lines 18-01 17:04:37.453 b79a4000 WDOG Inf p0 AppStartup.cpp:0030 ########## WDOG starting (MIP ASV 3.6.0.8) ########## 18-01 17:04:37.458 b79a4000 WDOG Inf p0 AppStartup.cpp:0041 HEWDG_DEAMON (MIP TIS-C Platform STD_BUILD for CCU-C2) 1.0.0.1 18-01 17:04:37.462 b79a4000 WDOG Inf p0 wdg_Configurat:0085 Reading configuration file '/usr/local/etc/hewdg/wdgConfig.xml' 18-01 17:04:37.472 b79a4000 WDOG Inf p0 wdg_Configurat:0140 Saving process list parameters: 18-01 17:04:37.472 b79a4000 WDOG Inf p0 wdg_Configurat:0141 Cmd 'ps -w' (timeout: 5s) 18-01 17:04:37.472 b79a4000 WDOG Inf p0 wdg_Configurat:0167 Saving logs parameters: 18-01 17:04:37.472 b79a4000 WDOG Inf p0 wdg_Configurat:0168 SavedLogsDir: /usr/local/data/ccuclogs/savedlogs 18-01 17:04:37.472 b79a4000 WDOG Inf p0 wdg_Configurat:0169 MaxNumSavedLogs: 100 make regex pattern with these fields {timestamp, threadid, component, level, priority, sourcefile, message}"}],

        messages=[{"role": "user", "content": "write 100 line essay about ai/ml"}],
        options={
            "num_gpu":    99,      # offload ALL layers to RTX 4050
            "num_ctx":    512,     # tiny context for this test
            "num_thread": 8,
            "temperature": 0.0,
        }
    )

    elapsed = time.perf_counter() - start
    reply = response.get("message", {}).get("content", "").strip()

    print(f"  Model reply : {reply}")
    print(f"  Time taken  : {elapsed:.2f}s")

    # Ollama returns eval_count (tokens generated) and eval_duration (ns)
    eval_count    = response.get("eval_count", 0)
    eval_duration = response.get("eval_duration", 1)  # nanoseconds
    tokens_per_s  = eval_count / (eval_duration / 1e9) if eval_duration else 0

    print(f"  Tokens/sec  : {tokens_per_s:.1f}  {'✅ fast (GPU)' if tokens_per_s > 20 else '⚠️  slow (may be CPU)'}")

    # Check GPU usage after inference
    print()
    print("  Post-inference VRAM usage:")
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0:
            used, util = [x.strip() for x in r.stdout.strip().split(",")]
            print(f"    VRAM used : {int(used):,} MiB")
            print(f"    GPU util  : {util}%")
    except Exception:
        pass

except ImportError:
    print("  ❌ ollama package not installed.")
    print("     Run: pip install ollama")
except Exception as e:
    print(f"  ❌ Ollama error: {e}")
    print("     • Is Ollama running? Run: ollama serve")
    print(f"     • Is model pulled?  Run: ollama pull {MODEL}")