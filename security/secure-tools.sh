#!/bin/bash

# Secure Files Manager - Unified tool for encrypting/decrypting sensitive files
# Usage: ./secure-tools.sh <action> [file] [password]

ACTION=$1
FILE=$2
PASSWORD=$3

if [ -z "$ACTION" ]; then
    echo "Secure Files Manager - Encrypt/Decrypt sensitive files"
    echo ""
    echo "Usage: ./secure-tools.sh <action> [file] [password]"
    echo ""
    echo "Actions:"
    echo "  encrypt <file>     - Encrypt a specific file"
    echo "  decrypt <file>     - Decrypt a specific file"
    echo "  encrypt-all        - Encrypt all sensitive files"
    echo "  decrypt-all        - Decrypt all sensitive files"
    echo "  delete-backups     - Delete all backup files"
    echo "  restore            - Restore files from backups"
    echo ""
    echo "Examples:"
    echo "  ./secure-tools.sh encrypt .env"
    echo "  ./secure-tools.sh decrypt .env mypassword"
    echo "  ./secure-tools.sh encrypt-all"
    echo "  ./secure-tools.sh decrypt-all mypassword"
    exit 1
fi

# If password not provided as argument and action requires it, prompt for it
if [ -z "$PASSWORD" ] && [[ "$ACTION" == "encrypt" || "$ACTION" == "decrypt" || "$ACTION" == "encrypt-all" || "$ACTION" == "decrypt-all" ]]; then
    read -s -p "Enter encryption password: " PASSWORD
    echo
fi

case $ACTION in
    encrypt)
        if [ -z "$FILE" ]; then
            echo "Error: File path required for encrypt action"
            exit 1
        fi
        echo "Encrypting $FILE..."
        node secure-files.js "$PASSWORD" encrypt "$FILE"
        ;;
    decrypt)
        if [ -z "$FILE" ]; then
            echo "Error: File path required for decrypt action"
            exit 1
        fi
        echo "Decrypting $FILE..."
        node secure-files.js "$PASSWORD" decrypt "$FILE"
        ;;
    encrypt-all)
        echo "Encrypting all sensitive files..."
        node secure-files.js "$PASSWORD" encrypt-all
        ;;
    decrypt-all)
        echo "Decrypting all sensitive files..."
        node secure-files.js "$PASSWORD" decrypt-all
        ;;
    delete-backups)
        echo "Deleting backup files..."
        node secure-files.js dummy delete-backups
        ;;
    restore)
        echo "Restoring from backups..."
        node secure-files.js dummy restore
        ;;
    *)
        echo "Invalid action. Use encrypt, decrypt, encrypt-all, decrypt-all, delete-backups, or restore"
        exit 1
        ;;
esac