#!/bin/bash

sudo ifconfig lo0 alias 172.16.123.4

# turn off the alias 
#sudo ifconfig lo0 -alias 172.16.123.4