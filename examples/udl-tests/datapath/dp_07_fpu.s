#
# UdL · Datapath 07 — FPU (coma flotante doble precision)
# Al ejecutar fadd.d / fmul.d se ILUMINA la unidad FPU.
#
.data
    a: .double 3.5
    b: .double 1.5
.text
main:
    la   t0, a
    fld  f0, 0(t0)         # f0 = 3.5
    la   t0, b
    fld  f2, 0(t0)         # f2 = 1.5
    fadd.d f4, f0, f2      # f4 = 5.0
    fmul.d f6, f0, f2      # f6 = 5.25
    li   a7, 10
    ecall
