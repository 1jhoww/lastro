import { ApiError } from '@/api/errors';
/** Estado do transporte, atualizado por eventos de identidade/empresa antes do próximo render. */
export class SessionTransportGuard {
  private uid: string | null = null;
  private tenantEpoch = 0;
  private identityRevision = 0;
  changeUser(uid: string | null) {
    if (this.uid !== uid) this.identityRevision++;
    this.uid = uid;
  }
  changeTenant() {
    this.tenantEpoch++;
  }
  capture(uid: string | null, tenantId: string | null, epoch = this.tenantEpoch) {
    const identityRevision = this.identityRevision;
    return (request: Request) => {
      if (
        tenantId &&
        (this.uid !== uid ||
          this.identityRevision !== identityRevision ||
          (request.method !== 'GET' && epoch !== this.tenantEpoch))
      )
        throw new ApiError(
          403,
          'TENANT_ACCESS_DENIED',
          'Identidade ou empresa mudou antes do envio',
        );
    };
  }
}
