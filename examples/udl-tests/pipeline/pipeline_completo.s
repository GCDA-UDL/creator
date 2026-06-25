#
# UdL · Test del PIPELINE (modo Datapath → Cycles)
# Riesgos clasicos: dependencia RAW, load-use, latencia del multiplicador y salto.
# Abre el panel "Pipeline config": con FORWARDING ON casi no hay burbujas;
# desactivalo (OFF) y observa como crecen los RAW stalls y el CPI.
#
.data
    v:  .word 5, 6, 7, 8
.text
main:
    # --- Cadena de dependencias RAW (lee el registro que la anterior escribe) ---
    addi t0, x0, 5            # t0 = 5
    addi t1, t0, 1            # RAW sobre t0  -> fwd ON: 0 burbujas | fwd OFF: ~2 burbujas (RAW)
    addi t2, t1, 1            # RAW sobre t1
    add  t3, t2, t1           # RAW sobre t2

    # --- Load-use: usar el dato recien cargado deja 1 burbuja AUNQUE haya forwarding ---
    la   t4, v
    lw   t5, 0(t4)            # LOAD (dato disponible en MEM)
    addi t6, t5, 1            # usa t5 justo despues -> 1 RAW stall (load-use), celda azul "RAW"

    # --- Multiplicador: latencia larga (M1..M7); el dependiente espera ---
    mul  a0, t0, t1           # ocupa M1..M7 en la rejilla
    addi a1, a0, 1            # depende del mul -> varias burbujas hasta M7

    # --- Salto tomado: penalizacion de control (resuelto en EX) ---
    beq  t0, t0, done         # TOMADO -> Branch-taken stalls
    addi a2, x0, 111          # (saltada)
done:
    li a7, 10                 # exit
    ecall
