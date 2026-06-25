#
# UdL · Test de MEMORIA VIRTUAL (modo Datapath → Virtual mem)
# Config por defecto: pagina 256 B, TLB 4 entradas, RAM 8 marcos (LRU).
# Recorre 8 paginas (stride = tamano de pagina) y luego las revisita.
# Tras ejecutar (Run), abre el modo Virtual mem y mira TLB hit rate y page faults.
# Para ver THRASHING: baja "RAM frames" a 3 y vuelve a mirar la 2a pasada.
#
.data
    big: .zero 2048           # 8 paginas de 256 B
.text
main:
    # --- 1a pasada: 1 palabra por pagina -> nueva pagina cada vez ---
    #     Cada pagina: TLB miss + PAGE FAULT (con RAM>=8 caben todas).
    la   t0, big
    li   t1, 0
    li   t2, 8                # 8 paginas
P1:
    beq  t1, t2, P1_end
    lw   t3, 0(t0)            # toca pagina nueva -> miss TLB + fallo de pagina
    addi t0, t0, 256          # salta a la siguiente pagina
    addi t1, t1, 1
    j    P1
P1_end:

    # --- 2a pasada: revisita las mismas paginas ---
    #     RAM=8: ya residentes -> 0 fallos de pagina (page-table hit).
    #     TLB=4 y 8 paginas en orden secuencial -> el TLB se recicla -> 0 TLB hit
    #     (analogo al fallo de conflicto en cache; ver vm_02 con 4 paginas para TLB hit).
    la   t0, big
    li   t1, 0
P2:
    beq  t1, t2, P2_end
    lw   t3, 0(t0)            # revisita -> TLB miss + page-table hit (sin fallo)
    addi t0, t0, 256
    addi t1, t1, 1
    j    P2
P2_end:

    li   a7, 10               # exit
    ecall
