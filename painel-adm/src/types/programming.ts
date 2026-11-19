export interface RadioProgram {
 presenters?:string[]; imageAssetId?:string|null; imageUrl?:string|null;
    id: string;
    name: string;
    slug: string;
    description: string;
    active: boolean;
    version: number;
}
export interface ProgramSlot {
    id: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
    validFrom: string;
    validUntil: string | null;
    active: boolean;
    version: number;
}
export interface ProgramHost {
    adminUserId: string;
    name: string;
    active: boolean;
    validFrom: string;
    validUntil: string | null;
}
export interface ProgramDetail {
    program: RadioProgram;
    slots: ProgramSlot[];
    hosts: ProgramHost[];
}
export interface SlotInput {
    weekday: number;
    startMinute: number;
    endMinute: number;
    validFrom: string;
    validUntil: string | null;
    active: boolean;
    version?: number;
}
export interface HostInput {
    active: boolean;
    validFrom: string;
    validUntil: string | null;
}
export interface ProgrammingOverride {id:string;programId:string|null;programName:string|null;startsAt:string;endsAt:string;reason:string;active:boolean;version:number}
export interface OverrideInput {programId:string|null;startsAt:string;endsAt:string;reason:string;active:boolean;version?:number}
