# Execution log — hardening multi-commerce v2 (segunda noche)

Rama `feature/demo-commerce-hardening-v2` (desde `feature/demo-commerce-hardening-v1` @ `ec52bab`). Sin
push, sin PR, sin despliegue.

> **Nota de medición.** `npm run test` ejecuta `vitest run` sin `include`, así que incluye
> `supabase/tests`: «Unit» es la suite completa y «DB» el subconjunto `npm run test:db`.

## N00
Status: PASS_WITH_KNOWN_ISSUE
Commit: (este commit; ver `git log -- docs/demo-hardening-v2/BASELINE.md`)
Files: `docs/demo-hardening-v2/BASELINE.md`, `docs/demo-hardening-v2/EXECUTION_LOG.md`
Tests: 196 archivos · 3 796 · 3 790 ✓ · 6 ✗ (los mismos 6 de H00/H14, verificados por nombre y causa)
Typecheck: PASS
Lint: PASS
DB: 82 archivos · 2 185 ✓
E2E: pila local reconstruida · ejecución 1: 43/44 · ejecución 2: 44/44
Bundle: PASS (portada 400,3/405)
Notes: el fallo E2E de la ejecución 1 es un defecto previo real (caché de `my_checkout_profile` tras la
primera compra); se corrige en N06. Secret scan PASS. Build 1 691 módulos.
