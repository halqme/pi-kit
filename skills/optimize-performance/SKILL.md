---
name: optimize-performance
description: Analyze or improve runtime performance, algorithmic complexity, memory use, resource management, caching, concurrency, or scalability. Use when the user asks for performance review, optimization, profiling, latency or throughput improvements, memory-leak investigation, cache design, resource-lifecycle analysis, or thread-safety and deadlock assessment.
---

# Optimize Performance

1. Define the workload, input scale, environment, latency or throughput target, resource constraints, and correctness invariants. Establish a baseline with profiling, benchmarks, traces, or production evidence when practical.
2. Inspect algorithms and data structures. Flag quadratic or worse behavior when reachable input size makes it material; identify avoidable repeated work, nested scans, allocations, copies, serialization, queries, and loops.
3. Inspect resource ownership and lifetime. Verify that files, streams, sockets, database connections, transactions, subscriptions, timers, workers, and buffers are closed, released, bounded, or cancelled on success and failure paths. Check for leaks and unbounded memory growth.
4. Consider caching only for demonstrably expensive, repeated work. Define cache key, scope, size bound, eviction, invalidation, consistency, failure behavior, and observability; choose memory, disk, distributed, or no cache based on lifetime and sharing needs.
5. Inspect concurrency and parallelism for useful independent work, backpressure, cancellation, bounded fan-out, ordering, shared-state safety, races, deadlocks, starvation, and atomicity. Prefer the simplest model that meets measured needs.
6. Remove unnecessary processing before adding complexity. Preserve correctness and avoid micro-optimizations without evidence.
7. Adversarially challenge the optimization with representative and worst-case inputs, warm and cold states, failure paths, sustained load, and contention. Check for shifted costs, regressions, stale-cache behavior, and misleading benchmarks.
8. Compare against the baseline and report effect size, measurement method, variance, resource tradeoffs, and remaining uncertainty. If measurement is unavailable, label recommendations as hypotheses rather than established improvements.
