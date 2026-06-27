# Plan de pruebas manual — extensión docente de CREATOR (UdL)

Plan de **validación manual** de las vistas de arquitectura añadidas a CREATOR (RISC-V/MIPS) en el
proyecto PID de la UdL. Está pensado para que **profesores de arquitectura de computadores** evalúen
si la parte **práctica** implementada es **coherente con la teoría**: cada documento guía paso a paso
qué cargar, qué hacer, **dónde** aparece cada valor en la interfaz, **qué** valor se espera y **por qué**
(con su justificación teórica y la fuente).

> No es un plan automático: complementa a los tests automáticos (`npm run test:unit`,
> `npm run test:e2e`). Aquí el evaluador es **humano** y juzga la coherencia con la teoría.

## Cómo arrancar CREATOR

```bash
cd CREATOR/GCDA-UDL-creator
npx vite            # abre http://localhost:5210
```

1. Elegir la arquitectura **RISC-V (RV32IMFD)**.
2. Botón **Examples** → en el desplegable de **conjuntos** elegir el grupo de la tabla de abajo →
   clicar el ejemplo.
3. Ejecutar con **Run** (todo) o **Step** (paso a paso, una instrucción).
4. Abrir la pestaña **Datapath** del simulador. Tiene 6 modos:
   **Blocks · Schematic · Cycles · Cache · Coherence · Virtual mem**.

## Mapa: módulo → ejemplo → vista → documento

| # | Módulo (sustituye a) | Grupo de ejemplos (Examples) | Modo de la vista | Documento |
|---|----------------------|------------------------------|------------------|-----------|
| 1 | **Datapath** (KIT Von Neumann) | `UdL · Test Datapath` | Datapath → **Schematic** | [01-datapath.md](01-datapath.md) |
| 2 | **Pipeline / ciclos** (WinMIPS64) | `UdL · Test Pipeline (Cycles)` | Datapath → **Cycles** | [02-pipeline.md](02-pipeline.md) |
| 3 | **Caché / jerarquía** (SMPcaché) | `UdL · Test Cache` | Datapath → **Cache** | [03-cache.md](03-cache.md) |
| 4 | **Coherencia MESI** (SMPcaché multinúcleo) | *(ejemplos internos del modo)* | Datapath → **Coherence** | [04-coherence.md](04-coherence.md) |
| 5 | **Memoria virtual** (TLB/paginación) | `UdL · Test Virtual memory` | Datapath → **Virtual mem** | [05-virtual-memory.md](05-virtual-memory.md) |
| 6 | **Lab E/S** (LEDs/switches/7-seg/matriz; KIT PR3/PR4) | `UdL · Test Lab (I/O)` | pestaña **Lab** | [06-lab.md](06-lab.md) |

> **Coherencia** es multinúcleo y CREATOR ejecuta un solo núcleo: por eso **no** se carga desde el
> desplegable Examples, sino que se valida con el **editor de trazas** y los **ejemplos integrados**
> dentro del propio modo *Coherence* (True/False sharing, MESI E→S→M, productor/consumidor).

## Programas de prueba — pequeños + uno "completo"

Cada grupo tiene **varios programas pequeños** (una casuística por programa, para validar caso por caso
sin pantallas enormes) y **uno `· completo`** al final (todas las casuísticas juntas, para una prueba
integral). Todos en [`examples/udl-tests/`](../../examples/udl-tests/) (`.s`, RV32IMFD, muy comentados
con "qué ver y dónde"), registrados en [`examples/example_set.json`](../../examples/example_set.json).
Los planes de validación de arriba usan el programa **completo**; los pequeños sirven para aislar un caso.

| Grupo | Programas pequeños | Completo |
|-------|--------------------|----------|
| Datapath | 01 Aritmética · 02 Lógica/shifts · 03 Mul · 04 Memoria · 05 Saltos · 06 Inmediato (U) · 07 FPU | Todos los formatos |
| Pipeline | 01 RAW · 02 Load-use · 03 Latencia mul · 04 Salto tomado | Todos los riesgos |
| Cache | 01 Espacial · 02 Temporal · 03 Conflicto · 04 Escrituras (WB) | Localidad + conflicto |
| Virtual mem | 01 Paginación · 02 Revisita (TLB) · 03 Thrashing | Paginación + revisita |
| Lab (I/O) | 01 LEDs · 02 Contador · 03 Switches · 04 Matriz · 05 7-seg · 06 Pulsador (IRQ) · 07 Pulsador (sondeo) | Todos los periféricos |

### Validación automática de los ejemplos

- **Estructura** (vitest): [`tests/unit/examplesUdl.spec.ts`](../unit/examplesUdl.spec.ts) — comprueba el
  *wiring* de los manifests, que cada `.s` referenciado existe y tiene `main:`+`ecall`, y que no hay
  programas huérfanos.
- **Ensamblado** (Playwright): [`tests/e2e/examples-udl.spec.ts`](../e2e/examples-udl.spec.ts) — carga y
  **ensambla cada uno** de los programas de cada grupo en CREATOR (sin errores de ensamblador).

## Cómo usar cada documento

Cada plan tiene: **Objetivo** · **Teoría aplicada** (con fuentes) · **Preparación** · **El programa** ·
**Pasos de validación** (tabla: paso · acción · dónde mirar · valor esperado · justificación) ·
**Variaciones** · **Checklist** (casillas para marcar si coincide con la teoría) · **Referencias**.
El profesor marca el checklist y anota cualquier discrepancia práctica↔teoría.

---

### Financiación

This work has been granted by the Ministerio de Ciencia, Innovación y Universidades (MICIU)
AEI/10.13039/501100011033 under contract PID2023-146193OB-I00.

*Grupo de Computación Distribuida (GCD-UdL), Universitat de Lleida — proyecto PID de innovación docente
(migración de KIT, WinMIPS64 y SMPcaché a RISC-V sobre CREATOR).*
