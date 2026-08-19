; Extra behaviour bolted onto the installer electron-builder generates.
; This file is compiled ahead of the generated script, so !defines made here
; reach the page declarations that come later.

!include LogicLib.nsh

; ---------------------------------------------------------------------------
; The "choose a folder" page
;
; By default NSIS re-checks the folder box on every keystroke and greys out the
; Install button the moment it dislikes what it sees. There is no explanation on
; screen — the button simply stops working — and it rejects perfectly ordinary
; answers: a bare drive root such as D:\, a folder that does not exist yet, a
; drive it cannot measure the free space of. A shopkeeper trying to put MyVault
; on their second drive just hits a dead end.
;
; "leave" verification keeps the button alive and moves the check to the moment
; it is pressed, where we can look at the folder ourselves and say something
; useful. The Modern UI turns this define into a DirVerify inside its own page
; block — writing DirVerify here instead is a compile error, because it is only
; valid inside PageEx.
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE

!ifndef BUILD_UNINSTALLER
  ; Where the installer would have put MyVault if nobody touched the box. Used
  ; as the last resort when the chosen folder turns out to be unwritable.
  Var defaultInstallDir
  Var managerName
  Var managerPin
  Var managerNameBox
  Var managerPinBox
  Var managerConfirmBox

  !macro customInit
    StrCpy $defaultInstallDir $INSTDIR
  !macroend

  ; Two pages after the folder is chosen: the hidden one that checks the folder,
  ; and the visible one that asks who will manage MyVault.
  ;
  ; The manager page is built inside the macro rather than at the top of this
  ; file, because nsDialogs and the Modern UI header macros do not exist yet
  ; when this file is compiled — they are included by the generated script
  ; afterwards, and the macro is expanded from there.
  !macro customPageAfterChangeDir
    Page custom acceptInstallDir
    Page custom managerPage managerPageLeave

    Function managerPage
      ; An update is not a new shop.
      ;
      ; This page used to appear every time, including when installing over a
      ; copy that has been in use for a year. The shop typed a new PIN, MyVault
      ; ignored it — an existing staff list is never overwritten — and the owner
      ; was left holding a PIN that does not open their own program. Asking at
      ; all was the mistake: if there is a shop on this machine already, its PIN
      ; and its staff are already set and none of this is anybody's business.
      IfFileExists "$APPDATA\MyVault\data\myvault.json" 0 +3
        StrCpy $managerName ""
        Abort

      !insertmacro MUI_HEADER_TEXT "Who will manage MyVault?" "Choose a PIN. You will type it to open MyVault, and you can add the rest of your staff afterwards."

      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 24u "MyVault will ask for this PIN each time it opens. Write it down somewhere safe — the first time it runs, MyVault shows you a recovery code in case the PIN is ever forgotten."

      ${NSD_CreateLabel} 0 32u 32% 12u "Your name"
      ${NSD_CreateText} 34% 30u 66% 13u "$managerName"
      Pop $managerNameBox

      ${NSD_CreateLabel} 0 52u 32% 12u "PIN (4 to 12 digits)"
      ${NSD_CreatePassword} 34% 50u 66% 13u ""
      Pop $managerPinBox

      ${NSD_CreateLabel} 0 72u 32% 12u "Type it again"
      ${NSD_CreatePassword} 34% 70u 66% 13u ""
      Pop $managerConfirmBox

      nsDialogs::Show
    FunctionEnd

    Function managerPageLeave
      ${NSD_GetText} $managerNameBox $managerName
      ${NSD_GetText} $managerPinBox $managerPin
      ${NSD_GetText} $managerConfirmBox $R1

      ${If} $managerName == ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "Enter the name of the person who will manage MyVault."
        Abort
      ${EndIf}

      StrLen $R2 $managerPin
      ${If} $R2 < 4
      ${OrIf} $R2 > 12
        MessageBox MB_OK|MB_ICONEXCLAMATION "The PIN must be between 4 and 12 digits."
        Abort
      ${EndIf}

      ; Copy across only the characters that really are digits, then insist the
      ; copy is identical. LogicLib's < and > compare numerically, which would
      ; read a letter as zero and let it through, so each character is matched
      ; against the ten digits by name instead.
      StrCpy $R5 ""
      StrCpy $R3 0
      ${Do}
        ${If} $R3 >= $R2
          ${Break}
        ${EndIf}
        StrCpy $R4 $managerPin 1 $R3
        ${If} $R4 == "0"
        ${OrIf} $R4 == "1"
        ${OrIf} $R4 == "2"
        ${OrIf} $R4 == "3"
        ${OrIf} $R4 == "4"
        ${OrIf} $R4 == "5"
        ${OrIf} $R4 == "6"
        ${OrIf} $R4 == "7"
        ${OrIf} $R4 == "8"
        ${OrIf} $R4 == "9"
          StrCpy $R5 "$R5$R4"
        ${EndIf}
        IntOp $R3 $R3 + 1
      ${Loop}

      ${IfNot} $R5 == $managerPin
        MessageBox MB_OK|MB_ICONEXCLAMATION "The PIN must be digits only."
        Abort
      ${EndIf}

      ${IfNot} $managerPin == $R1
        MessageBox MB_OK|MB_ICONEXCLAMATION "The two PINs are different. Please type the same one twice."
        Abort
      ${EndIf}
    FunctionEnd
  !macroend

  Function acceptInstallDir
    ; An empty box means "wherever you like".
    ${If} $INSTDIR == ""
      StrCpy $INSTDIR $defaultInstallDir
    ${EndIf}

    ; "D:\" becomes "D:", so appending below gives D:\MyVault rather than D:\\MyVault.
    StrCpy $0 $INSTDIR 1 -1
    ${If} $0 == "\"
      StrCpy $INSTDIR $INSTDIR -1
    ${EndIf}

    ; Install into a MyVault folder, never loose in a drive root — otherwise
    ; uninstalling would take the rest of the drive with it. electron-builder
    ; does this too, but it looks for "MyVault" anywhere in the path; checking
    ; the tail means "D:\MyVaultBackups" still gets its own subfolder.
    StrLen $1 "${APP_FILENAME}"
    IntOp $1 $1 + 1
    IntOp $2 0 - $1
    StrCpy $0 $INSTDIR $1 $2
    ${If} $0 != "\${APP_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}

    ; Now prove the folder can be written to, rather than discovering halfway
    ; through the copy that it cannot. A second drive, a USB stick and a network
    ; share all pass this if they are genuinely writable.
    ClearErrors
    CreateDirectory "$INSTDIR"
    FileOpen $3 "$INSTDIR\.myvault-write-test" w
    ${IfNot} ${Errors}
      FileClose $3
      Delete "$INSTDIR\.myvault-write-test"
      Abort ; folder is fine — skip this page and start installing
    ${EndIf}

    ; Read-only, full, or needing rights this installer was not given. Say so
    ; and carry on somewhere that works, rather than failing mid-install.
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "MyVault cannot write to:$\r$\n$INSTDIR$\r$\n$\r$\nThat drive or folder may be read-only, full, or need administrator rights.$\r$\n$\r$\nMyVault will be installed here instead:$\r$\n$defaultInstallDir"
    StrCpy $INSTDIR $defaultInstallDir
    Abort
  FunctionEnd
!endif

; ---------------------------------------------------------------------------
; Who will manage this copy
;
; The shop owner sets their own PIN here, during installation, so MyVault is
; never sitting unattended with no manager. The name and PIN are handed to the
; program through the registry, which it reads once on its first run and then
; deletes — from that point the PIN exists only as a salted scrypt hash inside
; the data file. It is written in the clear for exactly that gap, on the same
; machine it is being installed on; the README says so plainly.

; Records the language chosen on the installer's first screen so MyVault can
; open in that language the first time it runs, and hands over the manager set
; up on the page above. MyVault deletes both PIN values the first time it runs.
!macro customInstall
  WriteRegStr HKCU "Software\MyVault" "InstallerLanguage" "$LANGUAGE"
  ${If} $managerName != ""
    WriteRegStr HKCU "Software\MyVault" "SetupName" "$managerName"
    WriteRegStr HKCU "Software\MyVault" "SetupPin" "$managerPin"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\MyVault"
!macroend
