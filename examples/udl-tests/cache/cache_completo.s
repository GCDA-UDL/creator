#
# UdL · Test de la CACHE (modo Datapath → Cache)
# Config por defecto: 8 lineas, 2 vias, bloque 16 B (4 palabras) -> 4 conjuntos.
# Tres patrones: localidad ESPACIAL, localidad TEMPORAL y CONFLICTO.
# Tras ejecutar (Run), abre el modo Cache y mira hit rate, AMAT y la clasificacion.
#
.data
    arr: .word  0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47
.text
main:
    # --- A) Localidad ESPACIAL: recorrido secuencial de 16 palabras (4 bloques) ---
    #     1 fallo COMPULSORY por bloque (cada 4 palabras); las otras 3 son HIT.
    la   t0, arr
    li   t1, 0
    li   t2, 16
A_loop:
    beq  t1, t2, A_end
    lw   t3, 0(t0)            # arr[i]: miss al entrar en bloque nuevo, luego HIT x3
    addi t0, t0, 4
    addi t1, t1, 1
    j    A_loop
A_end:

    # --- B) Localidad TEMPORAL: segundo recorrido; 4 bloques caben -> todo HIT ---
    la   t0, arr
    li   t1, 0
B_loop:
    beq  t1, t2, B_end
    lw   t3, 0(t0)            # ya esta en cache -> HIT
    addi t0, t0, 4
    addi t1, t1, 1
    j    B_loop
B_end:

    # --- C) CONFLICTO: 3 bloques que caen en el MISMO conjunto (set 0) ---
    #     offsets 0, 64, 128 -> bloques 0, 4, 8 -> index = bloque mod 4 = 0.
    #     Cache 2-vias: el 3er bloque expulsa al mas antiguo -> CONFLICT miss cada vuelta.
    la   t4, arr
    li   t5, 0
    li   t6, 4
C_loop:
    beq  t5, t6, C_end
    lw   a0, 0(t4)           # bloque 0 (set 0)
    lw   a0, 64(t4)          # bloque 4 (set 0)
    lw   a0, 128(t4)         # bloque 8 (set 0) -> expulsion -> miss de CONFLICTO
    addi t5, t5, 1
    j    C_loop
C_end:

    li   a7, 10              # exit
    ecall
