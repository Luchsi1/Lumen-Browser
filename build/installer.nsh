; Registers Lumen with Windows so it appears under Settings > Apps > Default apps as a browser.
; Per-user only (HKCU), no admin rights needed. Nothing here claims http/https or .html by itself:
; the user chooses Lumen in Default apps. No shell change notification is sent on purpose.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\LumenHTML" "" "Lumen HTML Document"
  WriteRegStr HKCU "Software\Classes\LumenHTML\Application" "ApplicationName" "Lumen"
  WriteRegStr HKCU "Software\Classes\LumenHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\LumenHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Classes\LumenURL" "" "Lumen URL"
  WriteRegStr HKCU "Software\Classes\LumenURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\LumenURL\Application" "ApplicationName" "Lumen"
  WriteRegStr HKCU "Software\Classes\LumenURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\LumenURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen" "" "Lumen"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities" "ApplicationName" "Lumen"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities" "ApplicationDescription" "Lumen web browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities\URLAssociations" "http" "LumenURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities\URLAssociations" "https" "LumenURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities\FileAssociations" ".htm" "LumenHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Lumen\Capabilities\FileAssociations" ".html" "LumenHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Lumen" "Software\Clients\StartMenuInternet\Lumen\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\LumenHTML"
  DeleteRegKey HKCU "Software\Classes\LumenURL"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Lumen"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Lumen"
!macroend
