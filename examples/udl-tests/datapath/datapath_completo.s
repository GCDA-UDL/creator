#
# UdL · Test del DATAPATH (modo Datapath → Schematic)
# Una instruccion de cada formato RISC-V + unidades M y FPU.
# Ejecuta PASO A PASO (Step) y observa, en cada paso, que etapa se ilumina
# y los valores rs1/rs2/rd que muestra el esquema.
#
.data
    arr:  .word 7, 11          # vector de datos para load/store
    res:  .word 0
    da:   .double 3.5          # operando doble para la FPU
    db:   .double 1.5
.text
main:
    addi t0, x0, 10            # [I] rd=t0  rs1=x0  imm=10   -> EX: t0 = 10
    addi t1, x0, 12            # [I] rd=t1            imm=12  -> EX: t1 = 12
    add  t2, t0, t1            # [R] rd=t2  rs1=t0 rs2=t1     -> ALU = 22  (MUX usa rs2)
    sub  t3, t1, t0            # [R] resta 12-10             -> ALU = 2
    and  t4, t0, t1            # [LOGIC] 1010 & 1100         -> ALU = 8
    mul  t5, t0, t1            # [M] multiplicador           -> se ILUMINA la unidad MUL, t5 = 120

    lui  s0, 0x12345           # [U] inmediato alto          -> rd=s0, sin rs
    la   a1, arr               # [U+I] pseudo (auipc+addi)   -> direccion base de arr

    lw   a2, 0(a1)             # [I-mem] LOAD                -> etapa MEM (DataMem), a2 = 7
    sw   t2, 4(a1)             # [S]    STORE                -> etapa MEM escribe, arr[1] = 22

    beq  t0, t0, taken         # [B] salto TOMADO (t0==t0)   -> aparece la ruta "branch taken"
    addi a3, x0, 999           # (no se ejecuta: saltada)
taken:
    bne  t0, t1, no_taken      # [B] t0!=t1 -> tambien tomado
    j    skip
no_taken:
    addi a3, x0, 1
skip:

    # --- FPU (doble precision) ---
    la   a4, da
    fld  f0, 0(a4)             # carga 3.5 en f0
    la   a4, db
    fld  f2, 0(a4)             # carga 1.5 en f2
    fadd.d f4, f0, f2          # [FPU] se ILUMINA la unidad FPU, f4 = 5.0

    li   a7, 10                # exit
    ecall
